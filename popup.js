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
 
 // Update the quotePdfButton click handler
document.getElementById('quotePdfButton').addEventListener('click', async () => {
  try {
    setButtonsLoading(true);
    showStatus('Generating quote...', 'success');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const apiKey = CONFIG.OPENAI_API_KEY;

    // Get products first
    const productsResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (apiKey) => {
        const emailContainers = document.querySelectorAll('.gs');
        let emailContent = '';
        emailContainers.forEach((container) => {
          emailContent += container.innerText + '\n';
        });

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
                  5. price (leave empty for manual filling)`
              },
              {
                role: "user",
                content: `Extract product information from this email: ${emailContent}`
              }
            ]
          })
        });

        const data = await response.json();
        let products = [];
        try {
          const content = data.choices[0].message.content;
          products = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
        } catch (error) {
          console.error('Error parsing products:', error);
          products = [{ srNo: 1, code: 'Error', name: 'Could not parse products', qty: 1, price: '' }];
        }
        return products;
      },
      args: [apiKey]
    });

    const products = productsResult[0].result;
    
    // Inject required libraries
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/jspdf.umd.min.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/jspdf.plugin.autotable.min.js']
    });

    // Get the image URLs
    const headerUrl = chrome.runtime.getURL('images/header.jpg');
    const footerUrl = chrome.runtime.getURL('images/footer.jpg');

    // Generate PDF with products (not updated products)
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (products, headerUrl, footerUrl) => {
        try {
          // Create a global variable to store the callback
          window.__quotationCallback = null;

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

          // Load images
          const headerBase64 = await loadImage(headerUrl);
          const footerBase64 = await loadImage(footerUrl);

          // Create editable interface in the current tab
          const editorDiv = document.createElement('div');
          editorDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            z-index: 99999;
            display: flex;
            justify-content: center;
            align-items: center;
          `;

          const editorContent = document.createElement('div');
          editorContent.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 12px;
            width: 800px;
            max-height: 90vh;
            overflow-y: auto;
          `;

          // Create table
          const table = document.createElement('table');
          table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          `;

          // Add table header
          const thead = `
            <thead>
              <tr>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Sr No</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Product Code</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Product Name</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Qty</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Price</th>
              </tr>
            </thead>
          `;

          // Add table body with editable cells
          const tbody = products.map(p => `
            <tr>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.srNo}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.code}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.name}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.qty || 1}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.price}</td>
            </tr>
          `).join('');

          table.innerHTML = thead + tbody;
          editorContent.appendChild(table);

          // Add table controls div above the table
          const tableControls = document.createElement('div');
          tableControls.style.cssText = `
            margin-bottom: 15px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 6px;
            display: flex;
            gap: 10px;
          `;

          // Add Row button
          const addRowBtn = document.createElement('button');
          addRowBtn.textContent = '+ Add Row';
          addRowBtn.style.cssText = `
            background: #48BB78;
            color: white;
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
          `;

          // Delete Row button
          const deleteRowBtn = document.createElement('button');
          deleteRowBtn.textContent = '- Delete Row';
          deleteRowBtn.style.cssText = `
            background: #F56565;
            color: white;
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
          `;

          // Add row handler
          addRowBtn.onclick = () => {
            const tbody = table.querySelector('tbody');
            const newRow = document.createElement('tr');
            const lastRow = tbody.lastElementChild;
            const lastSrNo = lastRow ? parseInt(lastRow.cells[0].textContent) || 0 : 0;
            
            newRow.innerHTML = `
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${lastSrNo + 1}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">1</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
            `;
            tbody.appendChild(newRow);
          };

          // Delete row handler
          deleteRowBtn.onclick = () => {
            const tbody = table.querySelector('tbody');
            if (tbody.children.length > 1) {
              tbody.removeChild(tbody.lastElementChild);
            }
          };

          // Add buttons to controls
          tableControls.appendChild(addRowBtn);
          tableControls.appendChild(deleteRowBtn);

          // Add controls before table
          editorContent.appendChild(tableControls);
          editorContent.appendChild(table);

          // Update table styles for better UX
          table.style.cssText += `
            border-collapse: collapse;
            width: 100%;
            margin-bottom: 20px;
          `;

          // Add hover effect to table rows
          const style = document.createElement('style');
          style.textContent = `
            #quotationTable tr:hover {
              background-color: #f5f5f5;
            }
            #quotationTable td:focus {
              outline: 2px solid #4299E1;
              outline-offset: -2px;
            }
          `;
          document.head.appendChild(style);
          table.id = 'quotationTable';

          // Add save button
          const saveBtn = document.createElement('button');
          saveBtn.textContent = 'Save & Update Email';
          saveBtn.style.cssText = `
            background: #4299E1;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            margin-top: 20px;
            margin-left: 10px;
            float: right;
          `;

          // Add cancel button
          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = 'Cancel';
          cancelBtn.style.cssText = `
            background: #E53E3E;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            margin-top: 20px;
            float: right;
          `;

          // Add cancel button click handler
          cancelBtn.onclick = () => {
            editorDiv.remove();
            if (window.__quotationCallback) {
              window.__quotationCallback({ success: false, cancelled: true });
            }
          };

          editorContent.appendChild(saveBtn);
          editorContent.appendChild(cancelBtn);
          editorDiv.appendChild(editorContent);
          document.body.appendChild(editorDiv);

          // Update the save button click handler
          saveBtn.onclick = async () => {
            try {
              // Get updated data
              const tableData = [];
              table.querySelectorAll('tbody tr').forEach(row => {
                const cells = row.cells;
                tableData.push({
                  srNo: cells[0].textContent,
                  code: cells[1].textContent,
                  name: cells[2].textContent,
                  qty: cells[3].textContent,
                  price: cells[4].textContent
                });
              });

              // Generate new PDF
              const newDoc = new jspdf.jsPDF();
              
              // Add header
              newDoc.addImage(headerBase64, 'JPEG', 0, 0, 210, 39);
              
              // Add updated table
              newDoc.autoTable({
                startY: 50,
                head: [['Sr No', 'Product Code', 'Product Name', 'Qty', 'Price']],
                body: tableData.map(p => [p.srNo, p.code, p.name, p.qty, p.price]),
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

              // Add terms and conditions
              const finalY = newDoc.previousAutoTable.finalY || 50;
              newDoc.setFontSize(10);
              newDoc.setFont(undefined, 'bold');
              newDoc.text('Please Note Our Company Name:', 20, finalY + 20);
              newDoc.setFont(undefined, 'normal');
              newDoc.text('Bombay Tools Supplying Agency (1942).', 20, finalY + 30);

              newDoc.setFont(undefined, 'bold');
              newDoc.text('Terms and Conditions:', 20, finalY + 45);
              newDoc.setFont(undefined, 'normal');
              const terms = [
                'GST: 18%',
                'Packing and Forwarding: Nil',
                'Freight: Extra At Actual.',
                'Delivery: 7-10 Days',
                'Payment: 100% Against Proforma Invoice.'
              ];

              terms.forEach((term, index) => {
                newDoc.text(term, 20, finalY + 55 + (index * 10));
              });

              // Add footer
              newDoc.addImage(footerBase64, 'JPEG', 0, newDoc.internal.pageSize.height - 39, 210, 39);

              // Create PDF blob and open in new tab
              const newPdfBlob = newDoc.output('blob');
              const pdfUrl = URL.createObjectURL(newPdfBlob);
              window.open(pdfUrl, '_blank');  // This will open PDF directly in the browser

              // Remove editor
              editorDiv.remove();

              // Create email reply with attachment
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
                await new Promise(resolve => setTimeout(resolve, 2000));
              }

              const composeArea = document.querySelector('[role="textbox"]');
              if (composeArea) {
                const message = `Please find attached the quotation for your inquiry.`;
                composeArea.innerHTML = message;
                composeArea.dispatchEvent(new Event('input', { bubbles: true }));

                await new Promise(resolve => setTimeout(resolve, 1000));

                const attachmentInput = document.querySelector('input[type="file"][name="Filedata"]');
                if (attachmentInput) {
                  const file = new File([newPdfBlob], 'quotation.pdf', { type: 'application/pdf' });
                  const dataTransfer = new DataTransfer();
                  dataTransfer.items.add(file);
                  attachmentInput.files = dataTransfer.files;
                  attachmentInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }

              // Clean up the object URL after a delay to ensure it's loaded
              setTimeout(() => {
                URL.revokeObjectURL(pdfUrl);
              }, 5000);

              // Notify the extension that we're done
              if (window.__quotationCallback) {
                window.__quotationCallback({ success: true });
              }
            } catch (error) {
              console.error('Error in save handler:', error);
              if (window.__quotationCallback) {
                window.__quotationCallback({ error: error.message });
              }
            }
          };

          // Return a promise that will be resolved when the save button is clicked
          return new Promise((resolve) => {
            window.__quotationCallback = resolve;
          });
        } catch (error) {
          console.error('PDF generation error:', error);
          return { error: error.message };
        }
      },
      args: [products, headerUrl, footerUrl]
    });

    // Keep checking the result
    const checkResult = setInterval(async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const checkStatus = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.__quotationCallback !== null
        });

        if (!checkStatus[0].result) {
          // Process is complete
          clearInterval(checkResult);
          if (result[0].result && result[0].result.error) {
            showError(result[0].result.error);
          } else {
            showStatus('Quote generated successfully!', 'success');
          }
          setButtonsLoading(false);
        }
      } catch (error) {
        clearInterval(checkResult);
        console.error('Error checking result:', error);
        showError(error.message);
        setButtonsLoading(false);
      }
    }, 1000);

    // Clear the interval after 30 seconds (timeout)
    setTimeout(() => {
      clearInterval(checkResult);
    }, 30000);
  } catch (error) {
    console.error('Error:', error);
    showError(error.message);
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