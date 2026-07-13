import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, FileText, Download, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';

export default function App() {
  const [pdfJsLoaded, setPdfJsLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [files, setFiles] = useState([]);
  const [records, setRecords] = useState([]);
  const [errors, setErrors] = useState([]);
  const fileInputRef = useRef(null);

  // Dynamically load PDF.js for client-side processing
  useEffect(() => {
    const loadPdfJs = () => {
      if (!window.pdfjsLib) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
        script.async = true;
        script.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
          setPdfJsLoaded(true);
        };
        document.body.appendChild(script);
      } else {
        setPdfJsLoaded(true);
      }
    };
    loadPdfJs();
  }, []);

  const parsePDFText = (rawText) => {
    // Flatten all whitespace/newlines into single spaces for robust regex matching
    const cleanText = rawText.replace(/\s+/g, ' ').trim();
    
    let refNo = '';
    let date = '';
    let partyName = '';
    let gstNo = '';
    let place = '';
    let total = 0, igst = 0, cgst = 0, sgst = 0, amount = 0;

    // 1. Reference No
    const refMatch = cleanText.match(/Invoice No (dc\d+\/\d{4}\/\d+)/i) || cleanText.match(/(dc\d+\/\d{4}\/\d+)/i);
    if (refMatch) refNo = refMatch[1];

    // 2. Invoice Date
    const dateMatch = cleanText.match(/Invoice Date (\d{2}\/\d{2}\/\d{4})/i);
    if (dateMatch) {
      const [dd, mm, yyyy] = dateMatch[1].split('/');
      date = `${yyyy}-${mm}-${dd}`; // Convert to YYYY-MM-DD
    }

    // 3. Party A/C Name & GST Number
    // Stops matching name if it hits GSTIN, MIND ARCHITECT, PAN, TAX INVOICE, a table pipe (|), or SI No.
    const billToMatch = cleanText.match(/Bill To:\s*(.*?)\s*(?:GSTIN\s*:|MIND ARCHITECT|VO-726|PAN\b|TAX INVOICE|Invoice No|\||SI No)/i);
    if (billToMatch) {
      partyName = billToMatch[1].replace(/"/g, '').trim();
      // Ensure party name doesn't get ridiculously long if regex misses a boundary
      if (partyName.length > 50) {
        partyName = partyName.substring(0, 50).trim() + '...';
      }
    }

    // Default to OTHER if party name is empty
    if (!partyName) {
      partyName = 'OTHER';
    }

    const gstMatch = cleanText.match(/GSTIN\s*:\s*([A-Z0-9]{15})/i);
    if (gstMatch) {
      gstNo = gstMatch[1];
    }

    // 4. Place of Supply (Highly targeted search area)
    const states = [
      "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", 
      "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", 
      "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", 
      "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Chandigarh", "Delhi", "Puducherry", 
      "Jammu and Kashmir", "Ladakh", "Other Territory"
    ];
    
    // Look for the state ONLY in the immediate vicinity of "Place of Supply" to avoid false positives
    const supplyIndex = cleanText.toLowerCase().indexOf('place of supply');
    if (supplyIndex !== -1) {
      const searchArea = cleanText.substring(supplyIndex, supplyIndex + 100);
      const foundState = states.find(s => searchArea.toLowerCase().includes(s.toLowerCase()));
      if (foundState) place = foundState;
    }
    
    // Fallback search around "Buyer State" 
    if (!place) {
      const stateIndex = cleanText.toLowerCase().indexOf('buyer state');
      if (stateIndex !== -1) {
        const searchArea = cleanText.substring(stateIndex, stateIndex + 100);
        const foundState = states.find(s => searchArea.toLowerCase().includes(s.toLowerCase()));
        if (foundState) place = foundState;
      }
    }

    // Fallback to OTHER if no state is detected
    if (!place) {
      place = 'OTHER';
    }

    // 5. Total Amount
    const totalMatch = cleanText.match(/Grand Total (\d+(?:\.\d+)?) For MIND ARCHITECT/i) || cleanText.match(/Grand Total (\d+(?:\.\d+)?)/i);
    if (totalMatch) total = parseFloat(totalMatch[1]);

    // 6. Taxes
    const igstMatch = cleanText.match(/IGST 18% (\d+(?:\.\d+)?)/i);
    if (igstMatch) igst = parseFloat(igstMatch[1]);

    const cgstMatch = cleanText.match(/CGST 9% (\d+(?:\.\d+)?)/i);
    if (cgstMatch) cgst = parseFloat(cgstMatch[1]);

    const sgstMatch = cleanText.match(/SGST 9% (\d+(?:\.\d+)?)/i);
    if (sgstMatch) sgst = parseFloat(sgstMatch[1]);

    // 7. Calculate Taxable Amount & Setup Particulars
    amount = Number((total - (igst + cgst + sgst)).toFixed(2));
    let particulars = 'Sales of Service@ 18%';
    if (igst > 0) particulars += ' IGST';
    else if (cgst > 0 || sgst > 0) particulars += ' CGST/SGST';

    return {
      refNo,
      date,
      gstNo,
      partyName,
      place,
      particulars,
      amount,
      sgst,
      cgst,
      igst,
      total
    };
  };

  const extractTextFromPdf = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Join text components preserving some spacing
      const strings = content.items.map(item => item.str);
      fullText += strings.join(' ') + '\n';
    }
    
    return fullText;
  };

  const processFiles = async (selectedFiles) => {
    setIsProcessing(true);
    setErrors([]);
    const newRecords = [];
    const newErrors = [];

    for (const file of selectedFiles) {
      try {
        const text = await extractTextFromPdf(file);
        const data = parsePDFText(text);
        
        if (!data.refNo && !data.partyName && data.total === 0) {
           newErrors.push(`${file.name}: Unrecognized format`);
        } else {
           newRecords.push({ ...data, fileName: file.name });
        }
      } catch (err) {
        console.error(err);
        newErrors.push(`${file.name}: Failed to read PDF`);
      }
    }

    setRecords(prev => [...prev, ...newRecords]);
    setErrors(prev => [...prev, ...newErrors]);
    setIsProcessing(false);
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  const onDrop = (e) => {
    e.preventDefault();
    if (!pdfJsLoaded) return;
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (droppedFiles.length > 0) {
      setFiles(prev => [...prev, ...droppedFiles]);
      processFiles(droppedFiles);
    }
  };

  const handleFileSelect = (e) => {
    if (!pdfJsLoaded) return;
    const selectedFiles = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles]);
      processFiles(selectedFiles);
    }
    e.target.value = null; // Reset input
  };

  const exportCSV = () => {
    if (records.length === 0) return;

    const headers = [
      "REFERANCE NO", "INVOICE DATE", "GST NO", "PARTY A/C NAME", "PLACE OF SUPPLY", 
      "PARTICULARS", "AMOUNT", "SGST", "CGST", "IGST", "TOTAL AMOUNT"
    ];

    const rows = records.map(r => [
      r.refNo,
      r.date,
      r.gstNo,
      `"${r.partyName}"`, // Enclose in quotes to handle commas in names
      r.place,
      `"${r.particulars}"`,
      r.amount,
      r.sgst,
      r.cgst,
      r.igst,
      r.total
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", `Sales_Register_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const removeRecord = (indexToRemove) => {
    setRecords(records.filter((_, idx) => idx !== indexToRemove));
  };

  const clearAll = () => {
    setRecords([]);
    setFiles([]);
    setErrors([]);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">PDF to CSV Transcriber</h1>
            <p className="text-slate-500 mt-1">Upload vendor invoices to generate your automated Sales Register.</p>
          </div>
          <div className="flex gap-3">
             <button 
                onClick={clearAll}
                disabled={records.length === 0}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors shadow-sm"
              >
                Clear Data
              </button>
            <button 
              onClick={exportCSV}
              disabled={records.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors shadow-sm"
            >
              <Download size={18} />
              Export to CSV
            </button>
          </div>
        </div>

        {/* Upload Zone */}
        <div 
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-all ${
            !pdfJsLoaded ? 'border-slate-200 bg-slate-100' : 'border-blue-300 bg-blue-50/50 hover:bg-blue-50 cursor-pointer'
          }`}
          onClick={() => pdfJsLoaded && fileInputRef.current.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            className="hidden" 
            multiple 
            accept="application/pdf"
          />
          
          <div className="flex flex-col items-center justify-center space-y-3">
            {isProcessing ? (
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            ) : (
              <UploadCloud size={48} className={`mb-2 ${pdfJsLoaded ? 'text-blue-500' : 'text-slate-400'}`} />
            )}
            
            <h3 className="text-lg font-semibold">
              {!pdfJsLoaded ? 'Initializing Engine...' : (isProcessing ? 'Processing Invoices...' : 'Drag & Drop PDF Invoices Here')}
            </h3>
            <p className="text-slate-500 max-w-sm text-sm">
              {!pdfJsLoaded ? 'Please wait a moment while we load the PDF processing library.' : 'Or click to browse your files. We extract data securely directly in your browser.'}
            </p>
          </div>
        </div>

        {/* Error Messages */}
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3">
            <AlertCircle className="shrink-0 mt-0.5" size={20} />
            <div>
              <h4 className="font-semibold mb-1">Some files had issues</h4>
              <ul className="text-sm space-y-1 list-disc list-inside">
                {errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <FileText size={20} className="text-blue-600" />
              Parsed Records ({records.length})
            </h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase tracking-wider text-xs">
                <tr>
                  <th className="px-6 py-4 font-semibold">Reference No</th>
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4 font-semibold">Party Name</th>
                  <th className="px-6 py-4 font-semibold">GSTIN</th>
                  <th className="px-6 py-4 font-semibold">State</th>
                  <th className="px-6 py-4 font-semibold text-right">Amount</th>
                  <th className="px-6 py-4 font-semibold text-right">Tax (S/C/I)</th>
                  <th className="px-6 py-4 font-semibold text-right">Total</th>
                  <th className="px-6 py-4 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-6 py-12 text-center text-slate-400">
                      No invoices processed yet. Upload PDFs to see data here.
                    </td>
                  </tr>
                ) : (
                  records.map((record, index) => (
                    <tr key={index} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900">{record.refNo || '-'}</td>
                      <td className="px-6 py-4">{record.date || '-'}</td>
                      <td className="px-6 py-4">
                        <div className="truncate max-w-[150px]" title={record.partyName}>
                          {record.partyName || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">{record.gstNo || '-'}</td>
                      <td className="px-6 py-4">{record.place || '-'}</td>
                      <td className="px-6 py-4 text-right tabular-nums text-slate-600">₹{record.amount.toFixed(2)}</td>
                      <td className="px-6 py-4 text-right tabular-nums text-slate-500 text-xs">
                        {record.sgst > 0 && <span className="block">S: {record.sgst}</span>}
                        {record.cgst > 0 && <span className="block">C: {record.cgst}</span>}
                        {record.igst > 0 && <span className="block">I: {record.igst}</span>}
                        {record.sgst === 0 && record.cgst === 0 && record.igst === 0 && '-'}
                      </td>
                      <td className="px-6 py-4 text-right tabular-nums font-semibold text-slate-900">₹{record.total.toFixed(2)}</td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => removeRecord(index)}
                          className="text-slate-400 hover:text-red-500 transition-colors"
                          title="Remove row"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}