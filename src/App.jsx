import React, { useState } from "react";
import Tesseract from "tesseract.js";
import { Groq } from "groq-sdk";
import * as pdfjs from "pdfjs-dist";

// Initialize PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true, // Required for client-side demo
});

const App = () => {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("idle"); // idle, processing, success, error
  const [errorLog, setErrorLog] = useState("");

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const processFiles = async () => {
    if (files.length === 0) return alert("Please upload files first");
    
    setStatus("processing");
    setErrorLog("");
    let fullText = "";

    try {
      for (const file of files) {
        if (file.type === "application/pdf") {
          // Process PDF
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjs.getDocument(arrayBuffer).promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport }).promise;
            
            const { data: { text } } = await Tesseract.recognize(canvas.toDataURL());
            fullText += text + "\n";
          }
        } else {
          // Process Images (png, jpg, tif)
          const { data: { text } } = await Tesseract.recognize(file);
          fullText += text + "\n";
        }
      }

      // Step 2: Send to GROQ
      setStatus("processing: Extracting Data via AI...");
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `Extract the following fields into a clean JSON object. 
            Variables: payee, tin, address, purpose, category (must be: training allowance/final pay/ Government Remittances, Manpower / Consultant , or Others), currency, amount (total), amountinwords (convert the numeric amount to words), accountnum, mobilenum, sib (invoice/receipt/control number). 
            If data is missing, use null. Output ONLY valid JSON.`
          },
          { role: "user", content: fullText }
        ],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" },
      });

      const extractedJson = JSON.parse(completion.choices[0].message.content);

      // Step 3: Send to PHP
      setStatus("processing: Saving to Server...");
      const response = await fetch("https://apps.equicomservices.com/rfp/salam.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extractedJson),
      });

      if (response.ok) {
        setStatus("success");
      } else {
        throw new Error(`Server failed: ${response.statusText}`);
      }

    } catch (err) {
      console.error(err);
      setStatus("error");
      setErrorLog(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 font-sans">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">RFP Document Processor</h1>
        
        {/* 1. UPLOAD */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Upload Documents (Images/PDF/TIF)</label>
          <input 
            type="file" 
            multiple 
            accept=".png,.jpg,.jpeg,.tif,.tiff,.pdf"
            onChange={handleFileChange}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {/* 2. BUTTON */}
        <button
          onClick={processFiles}
          disabled={status.includes("processing")}
          className={`w-full py-3 rounded-lg font-bold text-white transition ${
            status.includes("processing") ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {status.includes("processing") ? "Processing..." : "Process & Save"}
        </button>

        {/* 3. RESULT */}
        <div className="mt-8">
          {status === "success" && (
            <div className="p-4 bg-green-100 border border-green-400 text-green-700 rounded">
              ✅ Successfully processed and saved to server!
            </div>
          )}

          {status === "error" && (
            <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
              ❌ Error: {errorLog}
            </div>
          )}

          {status.includes("processing") && (
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 bg-blue-600 rounded-full animate-bounce"></div>
              <p className="text-blue-600 font-medium">{status}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;