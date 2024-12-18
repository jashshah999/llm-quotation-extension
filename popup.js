// Add these helper functions at the top of popup.js
function showStatus(message, type = 'success') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
  status.style.display = 'block';
  
  if (type === 'success') {
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }
}

function setButtonsLoading(loading) {
  const buttons = document.querySelectorAll('.action-button');
  buttons.forEach(button => {
    button.disabled = loading;
    if (loading) {
      button.classList.add('processing');
    } else {
      button.classList.remove('processing');
    }
  });
}

// Update the error handling
function showError(message) {
  const dialog = document.getElementById('dialog');
  const dialogMessage = document.getElementById('dialogMessage');
  dialogMessage.textContent = message;
  dialog.style.display = 'flex';
  setButtonsLoading(false);
  showStatus(message, 'error');
}

document.getElementById('replyButton').addEventListener('click', async () => {
  setButtonsLoading(true);
  showStatus('Generating reply...', 'success');
  console.log('Reply button clicked in popup');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // First get the API key from the current context
    const apiKey = CONFIG.OPENAI_API_KEY;
    
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [apiKey], // Pass the API key as an argument
      function: generateAndInsertReply,
    });
 
    if (result[0].result && result[0].result.error) {
      showError(result[0].result.error);
    }
  } catch (error) {
    showError('Error: ' + error.message);
  } finally {
    setButtonsLoading(false);
  }
 });
 
 async function generateAndInsertReply(apiKey) {
  // Helper function defined inside generateAndInsertReply so it's available in the webpage context
  function formatEmailReply(reply) {
    // Split the reply into lines
    const lines = reply.split('\n');
    
    // Process each line
    const formattedLines = lines.map(line => {
      // Add extra spacing after product sections
      if (line.trim().startsWith('Delivery Time:')) {
        return line + '<br><br>';
      }
      // Add spacing after the greeting
      if (line.includes('sir') || line.includes('madam')) {
        return line + '<br><br>';
      }
      // Add spacing after "We are pleased to quote the following:"
      if (line.includes('pleased to quote')) {
        return line + '<br><br>';
      }
      // Keep other lines as is
      return line;
    });

    // Join the lines back together with proper HTML line breaks
    let formattedReply = formattedLines.join('<br>');
    
    // Ensure proper spacing between products
    formattedReply = formattedReply.replace(/(<br>){3,}/g, '<br><br>'); // Remove excessive line breaks
    
    // Add extra spacing before the closing line
    formattedReply = formattedReply.replace(
      /(Looking forward to your response\.)/,
      '<br>$1'
    );

    return formattedReply;
  }

  try {
    const emailContainers = document.querySelectorAll('.gs');
    console.log('Found email containers:', emailContainers.length);
    
    if (emailContainers.length === 0) {
      return { error: 'No email content found. Please make sure you have an email open.' };
    }
 
    let emailContent = '';
    emailContainers.forEach((container) => {
      emailContent += container.innerText + '\n';
    });
    console.log('Email content extracted:', emailContent.substring(0, 100) + '...');
 
    if (!emailContent.trim()) {
      return { error: 'Email content appears to be empty.' };
    }
 
    // Find and click reply button
    const replyButtons = document.querySelectorAll('[role="button"]');
    console.log('Found buttons:', replyButtons.length);
    
    let replyButton;
    for (const button of replyButtons) {
      if (button.getAttribute('aria-label')?.toLowerCase().includes('reply')) {
        replyButton = button;
        break;
      }
    }
 
    if (!replyButton) {
      return { error: 'Reply button not found.' };
    }
 
    console.log('Found reply button, clicking it');
    replyButton.click();
 
    try {
      console.log('Making API call to OpenAI');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{
            role: "system",
            content: `You are a professional measurement instruments sales assistant. When replying to emails:
              1. Begin with a brief greeting using the sender's name - if the sender is male add "sir after name else add madam"
              2. Start with "We are pleased to quote the following:"
              3. For each product mentioned, format as:
              
              Product Code: [code]
              Product Name: [name]
              Make: [manufacturer]
              Measurement Range: [range]
              Price:
              Delivery Time: 
              If you dont know any of those just skip it except price and delivery time -have those regardless and ENUMERATE all the products 
              4. If multiple products, list each one in the same format with a blank line between them
              5. End with a simple "Looking forward to your response."
              
              Keep the tone professional but concise. Focus only on the product details. No unnecessary text or pleasantries.
              
              Do not include:
              - Long introductions
              - Marketing language
              - Regards/signature blocks
              - Any price or delivery estimates
              
              Always leave price and delivery time with blank lines for manual filling.`
          }, {
            role: "user",
            content: `Please draft a professional reply to this email. Original email content: ${emailContent}`
          }],
          temperature: 0.7,
          max_tokens: 1000
        })
      });
 
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', errorText);
        return { error: `API Error: ${response.status} - ${errorText}` };
      }
 
      const data = await response.json();
      console.log('API response received:', data);
      const generatedReply = data.choices[0].message.content;
      
      // Format the reply with proper spacing and structure
      const formattedReply = formatEmailReply(generatedReply);
      console.log('Formatted reply:', formattedReply);
 
      // More reliable way to find and insert into reply box
      return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 20;
        
        const insertReplyText = () => {
          const messageBody = document.querySelector('[role="textbox"]');
          console.log('Attempt', attempts + 1, 'to find textbox');
          
          if (messageBody) {
            console.log('Found textbox, inserting reply');
            messageBody.innerHTML = formattedReply;
            messageBody.dispatchEvent(new Event('input', { bubbles: true }));
            resolve({ success: true });
          } else if (attempts < maxAttempts) {
            attempts++;
            setTimeout(insertReplyText, 500);
          } else {
            resolve({ error: 'Could not find reply textbox after multiple attempts.' });
          }
        };
 
        setTimeout(insertReplyText, 1000);
      });
 
    } catch (error) {
      console.error('API or insertion error:', error);
      return { error: 'API Error: ' + error.message };
    }
 
  } catch (error) {
    console.error('General error:', error);
    return { error: 'Error: ' + error.message };
  }
 }
 
 document.getElementById('closeDialog').addEventListener('click', () => {
  document.getElementById('dialog').style.display = 'none';
 });
 
 // Add new event listener for PDF button
document.getElementById('quotePdfButton').addEventListener('click', async () => {
  setButtonsLoading(true);
  showStatus('Generating quote...', 'success');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const apiKey = CONFIG.OPENAI_API_KEY;
    
    // First inject jsPDF library
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/jspdf.umd.min.js']
    });

    // Then inject autotable plugin
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/jspdf.plugin.autotable.min.js']
    });

    // Get the image URLs
    const headerUrl = chrome.runtime.getURL('images/header.jpg');
    const footerUrl = chrome.runtime.getURL('images/footer.jpg');

    // Wait a moment for libraries to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Then execute the PDF generation code
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (apiKey, headerUrl, footerUrl) => {
        try {
          // Helper function to load image as base64
          const loadImage = async (url) => {
            return new Promise((resolve, reject) => {
              fetch(url)
                .then(response => response.blob())
                .then(blob => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                })
                .catch(reject);
            });
          };

          // Get email content first
          const emailContainers = document.querySelectorAll('.gs');
          let emailContent = '';
          emailContainers.forEach((container) => {
            emailContent += container.innerText + '\n';
          });

          // Create PDF
          const doc = new jspdf.jsPDF();
          
          // Load and add header image
          try {
            console.log('Loading header from:', headerUrl);
            const headerBase64 = await loadImage(headerUrl);
            doc.addImage(headerBase64, 'JPEG', 0, 0, 210, 39); // A4 width is 210mm
          } catch (error) {
            console.error('Error loading header image:', error);
          }

          // Update the API call section in the PDF generation function
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: "gpt-3.5-turbo",
              messages: [
                {
                  role: "system",
                  content: `Extract product information from the email and format it as JSON array. For each product include:
                    1. srNo (number starting from 1)
                    2. code (Product Code if mentioned)
                    3. name (Product Name/Description)
                    4. qty (if mentioned, otherwise use 1)
                    5. price (leave empty for manual filling)

                    Example format:
                    [
                      {
                        "srNo": 1,
                        "code": "ABC123",
                        "name": "Digital Multimeter",
                        "qty": 1,
                        "price": ""
                      }
                    ]
                    
                    Include all products mentioned in the email. If a code is not mentioned, use "N/A".
                    Focus on identifying actual products and measurement instruments.`
                },
                {
                  role: "user",
                  content: `Extract product information from this email: ${emailContent}`
                }
              ],
              temperature: 0.7,
              max_tokens: 1000
            })
          });

          const data = await response.json();
          let products = [];
          try {
            const content = data.choices[0].message.content;
            console.log('API Response:', content);
            products = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
            
            // Ensure all products have the required fields
            products = products.map((p, index) => ({
              srNo: p.srNo || index + 1,
              code: p.code || 'N/A',
              name: p.name || 'Unknown Product',
              qty: p.qty || 1,
              price: p.price || ''
            }));
          } catch (error) {
            console.error('Error parsing products:', error);
            console.error('Raw content:', data.choices[0].message.content);
            products = [{ srNo: 1, code: 'Error', name: 'Could not parse products', qty: 1, price: '-' }];
          }

          // Add table
          doc.autoTable({
            startY: 50,
            head: [['Sr No', 'Product Code', 'Product Name', 'Qty', 'Price']],
            body: products.map(p => [p.srNo, p.code, p.name, p.qty || 1, p.price]),
            styles: {
              fontSize: 10,
              cellPadding: 5,
              lineColor: [0, 0, 0],
              lineWidth: 0.1
            },
            headStyles: {
              fillColor: [255, 255, 255],
              textColor: [0, 0, 0],
              fontStyle: 'bold',
              halign: 'center'
            },
            bodyStyles: {
              halign: 'center'
            },
            columnStyles: {
              0: { cellWidth: 20 },
              1: { cellWidth: 40 },
              2: { cellWidth: 80 },
              3: { cellWidth: 20 },
              4: { cellWidth: 30 }
            },
            theme: 'grid'
          });

          // Add terms and conditions after the table
          const finalY = doc.previousAutoTable.finalY || 50;
          doc.setFontSize(10);
          doc.setFont(undefined, 'bold');
          doc.text('Please Note Our Company Name:', 20, finalY + 20);
          doc.setFont(undefined, 'normal');
          doc.text('Bombay Tools Supplying Agency (1942).', 20, finalY + 30);

          doc.setFont(undefined, 'bold');
          doc.text('Terms and Conditions:', 20, finalY + 45);
          doc.setFont(undefined, 'normal');
          const terms = [
            'GST: 18%',
            'Packing and Forwarding: Nil',
            'Freight: Extra At Actual.',
            'Delivery: 7-10 Days',
            'Payment: 100% Against Proforma Invoice.'
          ];

          terms.forEach((term, index) => {
            doc.text(term, 20, finalY + 55 + (index * 10));
          });

          // Load and add footer image
          try {
            console.log('Loading footer from:', footerUrl);
            const footerBase64 = await loadImage(footerUrl);
            const footerY = finalY + 100; // Adjust if needed
            if (footerY > doc.internal.pageSize.height - 39) {
              doc.addPage();
              doc.addImage(footerBase64, 'JPEG', 0, doc.internal.pageSize.height - 39, 210, 39);
            } else {
              doc.addImage(footerBase64, 'JPEG', 0, doc.internal.pageSize.height - 39, 210, 39);
            }
          } catch (error) {
            console.error('Error loading footer image:', error);
          }

          // Generate PDF blob
          const pdfBlob = doc.output('blob');
          
          // Open PDF in new tab without switching to it
          const pdfUrl = URL.createObjectURL(pdfBlob);
          window.open(pdfUrl, '_blank', 'noopener');
          
          // Find and click reply button if not already in reply mode
          const replyButtons = document.querySelectorAll('[role="button"]');
          let replyButton;
          for (const button of replyButtons) {
            if (button.getAttribute('aria-label')?.toLowerCase().includes('reply')) {
              replyButton = button;
              break;
            }
          }
          if (replyButton) {
            replyButton.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // Find the compose area and attach PDF
          const composeArea = document.querySelector('[role="textbox"]');
          if (composeArea) {
            const message = `Please find attached the quotation for your inquiry.`;
            composeArea.innerHTML = message;
            composeArea.dispatchEvent(new Event('input', { bubbles: true }));

            // Attach the PDF
            const attachmentInput = document.querySelector('input[type="file"][name="Filedata"]');
            if (attachmentInput) {
              const file = new File([pdfBlob], 'quotation.pdf', { type: 'application/pdf' });
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);
              attachmentInput.files = dataTransfer.files;
              attachmentInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          
          return { success: true };
        } catch (error) {
          console.error('PDF generation error:', error);
          return { error: error.message };
        }
      },
      args: [apiKey, headerUrl, footerUrl]
    });

    if (result[0].result && result[0].result.error) {
      showError(result[0].result.error);
    } else {
      showStatus('Quote generated successfully!', 'success');
    }
  } catch (error) {
    console.error('Error in PDF generation:', error);
    showError('Error: ' + error.message);
  } finally {
    setButtonsLoading(false);
  }
});

// Add at the beginning of popup.js
document.getElementById('themeToggle').addEventListener('click', () => {
  const html = document.documentElement;
  const currentTheme = html.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', newTheme);
  
  // Save theme preference
  chrome.storage.local.set({ theme: newTheme });
});

// Load saved theme preference
chrome.storage.local.get(['theme'], (result) => {
  if (result.theme) {
    document.documentElement.setAttribute('data-theme', result.theme);
  }
});