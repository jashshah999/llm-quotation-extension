// This file will contain the script that gets injected into the page
window.generatePDF = (products, customerName) => {
  const doc = new window.jspdf.jsPDF();
  // ... rest of your PDF generation code ...
  return doc;
}; 