import React, { useState } from "react";
import Tesseract from "tesseract.js";
import { Groq } from "groq-sdk";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.js?url";

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const groq = new Groq({
  apiKey: import.meta.env.VITE_GROQ_API_KEY,
  dangerouslyAllowBrowser: true,
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
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: context, viewport }).promise;

            const { data: { text } } = await Tesseract.recognize(canvas.toDataURL());
            fullText += text + "\n";
          }
        } else {
          // Process images (png, jpg, tif)
          const { data: { text } } = await Tesseract.recognize(file);
          fullText += text + "\n";
        }
      }

      // Step 2: Send to GROQ for structured extraction
      setStatus("processing: Extracting Data via AI...");
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
          content: `
          Extract the following fields into a clean JSON object.

          VARIABLES:
          payee, tin, address, purpose,
          category (must be exactly one of:
          "training allowance/final pay/ Government Remittances",
          "Manpower / Consultant",
          "Others"),
          currency,
          amount (total amount due),
          amountinwords (convert numeric amount to words),
          accountnum,
          mobilenum,
          sib (invoice/receipt/control number).

          ----------------------------
          PAYEE RULES:
          1. The payee is the entity issuing the invoice or receipt (vendor/service provider).
          2. Do NOT use the following as the payee:
            - Name: "EQUICOM SERVICES, INC"
            - TIN: "008-188-644-000"
            - Address: "2F CIBI BUILDING ZAPOTE COR. MASCARDO, MAKATI CITY, 1200"
          3. If the document contains "From:" and "To:", the payee is under "From:".
          4. If the document contains "SOLD TO:" or "Customer Name:", the payee is NOT the entity in that section.
          5. If the document contains "By:", the payee is the entity after "By:".
          6. The TIN and address must belong to the payee only.
          7. The payee name is usually the first company listed at the top or near "From:".
          8. If uncertain, return null for payee, tin, and address.

          ----------------------------
          SIB RULES:
          1. SIB is the invoice number, OR number, SOA number, or sales invoice number issued by the payee.
          2. Extract values clearly labeled as:
            "Invoice No", "Invoice Number",
            "Sales Invoice", "Official Receipt",
            "OR No", "SOA", "Billing No".
          3. Ignore numbers labeled:
            Account Number, Permit Number, Acknowledgement Certificate,
            REF No, Control numbers unrelated to invoice.
          4. If multiple valid invoice numbers appear, choose the one clearly associated with the payee.
          5. If unclear, return null.

          ----------------------------
          AMOUNT RULES:
          1. Use the TOTAL AMOUNT DUE payable to the payee.
          2. If both VAT inclusive and net amounts exist, select the final payable amount.
          3. Convert numeric amount to words for "amountinwords".

          ----------------------------
          CURRENCY RULES:
          1. Detect from symbols like PHP, P, ₱, USD, etc.
          2. Normalize "P" or "₱" to "PHP".
          3. If currency cannot be determined, return null.

          ----------------------------
          CATEGORY RULES:
          - If payroll, allowance, remittance → "training allowance/final pay/ Government Remittances"
          - If service provider, internet, licensing, consulting → "Manpower / Consultant"
          - Otherwise → "Others"

          ----------------------------
          PURPOSE RULES:
          - Extract a short description of the invoice or service provided.
          - Usually from "Description", "Nature of Service", or line items.

          ----------------------------
          ACCOUNTNUM & MOBILENUM:
          - Extract only if explicitly labeled (e.g., Account Number, Mobile Number).
          - If missing, return null.

          ----------------------------
          VALIDATION NOTES:
          - Ignore any company info that matches Equicom’s name, TIN, or address.
          - If any value is uncertain, return null.
          - Output ONLY valid JSON.

          EXTRA:
          - Anchor payee, TIN, and address to the vendor section (top of document or "From:").
          - Anchor SIB to the payee-issued invoice/receipt/statement.
          - Do not pick numbers or addresses associated with the buyer (Equicom).

          `
          },
          { role: "user", content: fullText }
        ],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" },
      });

      const extractedJson = JSON.parse(completion.choices[0].message.content);

      // Step 3: Send to your PHP server
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

        {/* Upload */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload Documents (Images/PDF/TIF)
          </label>
          <input
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.tif,.tiff,.pdf"
            onChange={handleFileChange}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {/* Button */}
        <button
          onClick={processFiles}
          disabled={status.includes("processing")}
          className={`w-full py-3 rounded-lg font-bold text-white transition ${
            status.includes("processing") ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {status.includes("processing") ? "Processing..." : "Process & Save"}
        </button>

        {/* Status */}
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
