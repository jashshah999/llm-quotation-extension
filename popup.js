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

// Settings modal functionality
document.getElementById('settingsButton').addEventListener('click', () => {
  document.getElementById('settingsModal').style.display = 'block';
});

document.querySelector('.close-modal').addEventListener('click', () => {
  document.getElementById('settingsModal').style.display = 'none';
});

// Close modal when clicking outside
window.addEventListener('click', (event) => {
  const modal = document.getElementById('settingsModal');
  if (event.target === modal) {
    modal.style.display = 'none';
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved API key
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
    CONFIG.OPENAI_API_KEY = apiKey;  // Update CONFIG object with stored key
  }
});

// Update API key save handler
document.getElementById('saveApiKey').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    showError('Please enter an API key');
    return;
  }
  
  // Save to both local storage and CONFIG object
  await chrome.storage.local.set({ apiKey });
  CONFIG.OPENAI_API_KEY = apiKey;
  showStatus('API key saved successfully!', 'success');
  document.getElementById('settingsModal').style.display = 'none';
});

document.getElementById('replyButton').addEventListener('click', async () => {
  if (!CONFIG.OPENAI_API_KEY) {
    showError('Please enter your OpenAI API key in the settings');
    return;
  }
  
  setButtonsLoading(true);
  showStatus('Generating reply...', 'success');
  console.log('Reply button clicked in popup');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [CONFIG.OPENAI_API_KEY],
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
              If you dont know any of those just skip it except price and delivery time -have those regardless and ENUMERATE all the products so have 1,2,3 and so on - have numbers for each product. 
              4. If multiple products, list each one in the same format with a blank line between them
              5. Add delivery time that needs to be filled. only one - not after each product. this is importnat - only after all products are listed. 
              6. Add these three lines in this exact order:
                 GST 18% 
                 Freight extra at actual
                 Payment 100% against Proforma Invoice.

              7. End with ONLY "Looking forward to your response." as the final line.
              DO NOT add any other closing lines, thank you notes, or signatures.
              The response MUST end with exactly "Looking forward to your response." - no variations.
              
              Keep the tone professional but concise. Focus only on the product details. No unnecessary text or pleasantries.
              
              Do not include:
              - Long introductions
              - Marketing language
              - Regards/signature blocks
              - Any price or delivery estimates
              - Any closing lines after "Looking forward to your response."
              - Thank you notes
              - Additional signatures
              
              Always leave price with a blank line for manual filling. dont add a blank line after price - keep it as is
              
              Do not return JSON format, return plain text formatted as specified above.
              
              IMPORTANT: The email must end with exactly one instance of "Looking forward to your response." - no duplicates.`
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
  if (!CONFIG.OPENAI_API_KEY) {
    showError('Please enter your OpenAI API key in the settings');
    return;
  }
  try {
    setButtonsLoading(true);
    showStatus('Generating quote...', 'success');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Get products first
    let emailContent = '';
    const productsResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (apiKey) => {
        try {
          // Define the extraction function inside the script context
          function extractProductsAndCompany(data) {
            let products = [];
            let companyName = '';
            try {
              const content = data.choices[0].message.content;
              const parsedData = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
              products = parsedData.products || [];
              companyName = parsedData.companyName || '';
              
              // If no products were found, add a default empty product
              if (products.length === 0) {
                products = [{
                  srNo: 1,
                  description: '',
                  make: '',
                  code: '',
                  range: '',
                  rate: '',
                  remark: ''
                }];
              }
            } catch (error) {
              console.error('Error parsing data:', error);
              products = [{
                srNo: 1,
                description: 'Could not parse products',
                make: '',
                code: '',
                range: '',
                rate: '',
                remark: ''
              }];
              companyName = '';
            }
            return { products, companyName };
          }

          const emailContainers = document.querySelectorAll('.gs');
          console.log('Found email containers:', emailContainers.length);
          
          if (emailContainers.length === 0) {
            return { error: 'No email content found. Please make sure you have an email open.' };
          }

          let emailText = '';
          emailContainers.forEach((container) => {
            emailText += container.innerText + '\n';
          });
          
          console.log('Email content:', emailText.substring(0, 100) + '...');

          if (!emailText.trim()) {
            return { error: 'Email content appears to be empty.' };
          }

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
                  content: `Extract product information and company details from the email and format it as JSON. Include:
                    1. companyName (the recipient company name from the email)
                    2. products (array of products where each product includes:
                      - srNo (number starting from 1)
                      - description (Product Description)
                      - make (Manufacturer name)
                      - code (Product Code)
                      - range (Measurement Range)
                      - rate (leave empty for manual filling)
                      - remark (any additional remarks))
                    
                    Return the JSON in format:
                    {
                      "companyName": "extracted company name",
                      "products": [array of products]
                    }`
                },
                {
                  role: "user",
                  content: `Extract information from this email: ${emailText}`
                }
              ]
            })
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error:', errorText);
            return { error: `API Error: ${response.status} - ${errorText}` };
          }

          const data = await response.json();
          console.log('API Response:', data);
          
          const result = extractProductsAndCompany(data);
          console.log('Extracted data:', result);
          
          return {
            products: result.products,
            companyName: result.companyName,
            emailContent: emailText
          };
        } catch (error) {
          console.error('Script execution error:', error);
          return { error: error.message };
        }
      },
      args: [CONFIG.OPENAI_API_KEY]
    });

    // Add error handling for the result
    if (productsResult[0].result?.error) {
      showError(productsResult[0].result.error);
      setButtonsLoading(false);
      return;
    }

    if (!productsResult[0].result) {
      showError('Failed to extract product information from the email.');
      setButtonsLoading(false);
      return;
    }

    const { products, companyName, emailContent: extractedEmail } = productsResult[0].result;
    emailContent = extractedEmail;
    
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
      func: async (products, companyName, headerUrl, footerUrl, emailContent) => {
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

          // Create email preview button and container (add this right after creating editorContent)
          const emailPreviewBtn = document.createElement('button');
          emailPreviewBtn.textContent = 'Show Email';
          emailPreviewBtn.style.cssText = `
            background: #805AD5;
            color: white;
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            margin-bottom: 15px;
            display: block;
            width: 100%;
          `;

          const emailPreviewContainer = document.createElement('div');
          emailPreviewContainer.style.cssText = `
            display: none;
            margin: 15px 0;
            padding: 15px;
            background: #f8f9fa;
            border: 1px solid #ddd;
            border-radius: 6px;
            max-height: 200px;
            overflow-y: auto;
            white-space: pre-wrap;
          `;

          // Add click handler for email preview
          emailPreviewBtn.onclick = () => {
            const isVisible = emailPreviewContainer.style.display === 'block';
            emailPreviewContainer.style.display = isVisible ? 'none' : 'block';
            emailPreviewBtn.textContent = isVisible ? 'Show Email' : 'Hide Email';
            
            // Only set content if we're showing the container
            if (!isVisible) {
              emailPreviewContainer.textContent = emailContent;
            }
          };

          // Add the button and container to the editor content
          editorContent.appendChild(emailPreviewBtn);
          editorContent.appendChild(emailPreviewContainer);

          // Create company name input field
          const companyDiv = document.createElement('div');
          companyDiv.style.cssText = `
            margin-bottom: 20px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 6px;
          `;

          const companyLabel = document.createElement('label');
          companyLabel.textContent = 'Company Name: ';
          companyLabel.style.cssText = `
            font-weight: 500;
            margin-right: 10px;
          `;

          const companyInput = document.createElement('input');
          companyInput.type = 'text';
          companyInput.value = companyName; // Use the passed companyName
          companyInput.style.cssText = `
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            width: 300px;
          `;

          // Make it more obvious that it's editable
          companyInput.addEventListener('focus', function() {
            this.style.borderColor = '#4299E1';
            this.style.boxShadow = '0 0 0 2px rgba(66, 153, 225, 0.2)';
          });

          companyInput.addEventListener('blur', function() {
            this.style.borderColor = '#ddd';
            this.style.boxShadow = 'none';
          });

          // Add a small edit icon next to the input
          const companyInputWrapper = document.createElement('div');
          companyInputWrapper.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
          `;

          const editIcon = document.createElement('span');
          editIcon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
            </svg>
          `;
          editIcon.style.color = '#718096';

          companyInputWrapper.appendChild(companyInput);
          companyInputWrapper.appendChild(editIcon);

          // Update the company div to use the wrapper
          companyDiv.appendChild(companyLabel);
          companyDiv.appendChild(companyInputWrapper);
          editorContent.appendChild(companyDiv);

          // Add quotation number input field to the editor
          const quotationDiv = document.createElement('div');
          quotationDiv.style.cssText = `
            margin-bottom: 15px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 6px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          `;

          // Left side - Quotation number
          const quotationLeftDiv = document.createElement('div');
          quotationLeftDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
          `;

          const quotationLabel = document.createElement('label');
          quotationLabel.textContent = 'Quotation No: ';
          quotationLabel.style.cssText = `
            font-weight: 500;
            margin-right: 10px;
          `;

          const quotationInput = document.createElement('input');
          quotationInput.type = 'text';
          quotationInput.value = 'QTN/' + new Date().getFullYear() + '/' + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
          quotationInput.style.cssText = `
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            width: 200px;
          `;

          const quotationInputWrapper = document.createElement('div');
          quotationInputWrapper.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
          `;

          const quotationEditIcon = document.createElement('span');
          quotationEditIcon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
            </svg>
          `;
          quotationEditIcon.style.color = '#718096';

          quotationInputWrapper.appendChild(quotationInput);
          quotationInputWrapper.appendChild(quotationEditIcon);
          quotationLeftDiv.appendChild(quotationLabel);
          quotationLeftDiv.appendChild(quotationInputWrapper);

          // Right side - Date
          const dateDiv = document.createElement('div');
          dateDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
          `;

          const dateLabel = document.createElement('label');
          dateLabel.textContent = 'Date: ';
          dateLabel.style.cssText = `
            font-weight: 500;
            margin-right: 10px;
          `;

          const dateInput = document.createElement('input');
          dateInput.type = 'text';
          const today = new Date().toLocaleDateString('en-GB'); // Format as DD/MM/YYYY
          dateInput.value = today;
          dateInput.style.cssText = `
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            width: 120px;
          `;

          const dateInputWrapper = document.createElement('div');
          dateInputWrapper.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
          `;

          const dateEditIcon = document.createElement('span');
          dateEditIcon.innerHTML = quotationEditIcon.innerHTML; // Reuse the same edit icon
          dateEditIcon.style.color = '#718096';

          dateInputWrapper.appendChild(dateInput);
          dateInputWrapper.appendChild(dateEditIcon);
          dateDiv.appendChild(dateLabel);
          dateDiv.appendChild(dateInputWrapper);

          // Add both sections to the quotation div
          quotationDiv.appendChild(quotationLeftDiv);
          quotationDiv.appendChild(dateDiv);

          // Insert quotation div before company div in the editor
          editorContent.insertBefore(quotationDiv, companyDiv);

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
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Description</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Make</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Code</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Range</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Rate</th>
                <th style="border: 1px solid #ddd; padding: 12px; background: #f8f9fa;">Remark</th>
              </tr>
            </thead>
          `;

          // Update the tbody creation to match new structure
          let tbodyContent = products.map(p => `
            <tr>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.srNo}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.description || ''}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.make || ''}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.code || ''}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.range || ''}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.rate || ''}</td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${p.remark || ''}</td>
            </tr>
          `).join('');

          // Update the empty rows creation
          const currentRows = products.length;
          for (let i = currentRows; i < 3; i++) {
            tbodyContent += `
              <tr>
                <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;">${i + 1}</td>
                <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
                <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
                <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
                <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
                <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
                <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
              </tr>
            `;
          }

          table.innerHTML = thead + tbodyContent;
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
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
              <td contenteditable="true" style="border: 1px solid #ddd; padding: 12px;"></td>
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

          // Create terms editor section
          const termsDiv = document.createElement('div');
          termsDiv.style.cssText = `
            margin-top: 20px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 6px;
          `;

          // Company name section
          const companyNoteDiv = document.createElement('div');
          companyNoteDiv.style.marginBottom = '15px';
          
          const companyNoteLabel = document.createElement('div');
          companyNoteLabel.textContent = 'Company Note:';
          companyNoteLabel.style.fontWeight = 'bold';
          companyNoteLabel.style.marginBottom = '5px';
          
          const companyNoteInput = document.createElement('input');
          companyNoteInput.type = 'text';
          companyNoteInput.value = 'Bombay Tools Supplying Agency (1942).';
          companyNoteInput.style.cssText = `
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 10px;
          `;

          companyNoteDiv.appendChild(companyNoteLabel);
          companyNoteDiv.appendChild(companyNoteInput);
          termsDiv.appendChild(companyNoteDiv);

          // Terms and conditions section
          const termsLabel = document.createElement('div');
          termsLabel.textContent = 'Terms and Conditions:';
          termsLabel.style.fontWeight = 'bold';
          termsLabel.style.marginBottom = '5px';
          termsDiv.appendChild(termsLabel);

          const defaultTerms = [
            'GST: 18%',
            'Packing and Forwarding: Nil',
            'Freight: Extra At Actual.',
            'Delivery: 7-10 Days',
            'Payment: 100% Against Proforma Invoice.'
          ];

          const termsContainer = document.createElement('div');
          termsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 5px;
          `;

          defaultTerms.forEach((term) => {
            const termInput = document.createElement('input');
            termInput.type = 'text';
            termInput.value = term;
            termInput.style.cssText = `
              width: 100%;
              padding: 8px;
              border: 1px solid #ddd;
              border-radius: 4px;
            `;
            termsContainer.appendChild(termInput);
          });

          termsDiv.appendChild(termsContainer);
          editorContent.appendChild(termsDiv);

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
              // Get updated data with new structure
              const tableData = [];
              table.querySelectorAll('tbody tr').forEach(row => {
                const cells = row.cells;
                tableData.push({
                  srNo: cells[0].textContent,
                  description: cells[1].textContent,
                  make: cells[2].textContent,
                  code: cells[3].textContent,
                  range: cells[4].textContent,
                  rate: cells[5].textContent,
                  remark: cells[6].textContent
                });
              });

              // Get the updated company note and terms
              const updatedCompanyNote = companyNoteInput.value;
              const updatedTerms = Array.from(termsContainer.querySelectorAll('input')).map(input => input.value);

              // Generate new PDF
              const newDoc = new jspdf.jsPDF();
              
              // Add header
              newDoc.addImage(headerBase64, 'JPEG', 0, 0, 210, 39);

              // Add quotation number
              newDoc.setFontSize(12);
              newDoc.setFont(undefined, 'bold');
              newDoc.text(`Quotation No: ${quotationInput.value}`, 20, 45);

              // Add date
              newDoc.setFontSize(12);
              newDoc.setFont(undefined, 'bold');
              newDoc.text(`Date: ${dateInput.value}`, 150, 45);

              // Move company name down
              newDoc.text(`To: ${companyInput.value}`, 20, 55);

              // Update table position with maxY limit to leave space for terms
              newDoc.autoTable({
                startY: 65,
                head: [['Sr No', 'Description', 'Make', 'Code', 'Range', 'Rate', 'Remark']],
                body: tableData.map(p => [p.srNo, p.description, p.make, p.code, p.range, p.rate, p.remark]),
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
                  0: { cellWidth: 15 },  // Sr No
                  1: { cellWidth: 45 },  // Description
                  2: { cellWidth: 25 },  // Make
                  3: { cellWidth: 20 },  // Code
                  4: { cellWidth: 25 },  // Range
                  5: { cellWidth: 20 },  // Rate
                  6: { cellWidth: 30 }   // Remark
                },
                theme: 'grid',
                // Add margin at bottom to ensure space for terms
                margin: { bottom: 60 }
              });

              // Get final Y position after table
              let finalY = newDoc.previousAutoTable.finalY || 60;

              // Check if there's enough space for terms (need at least 100 units)
              const pageHeight = newDoc.internal.pageSize.height;
              const requiredSpace = 100; // Space needed for terms and conditions

              if (pageHeight - finalY < requiredSpace) {
                // Not enough space, add new page
                newDoc.addPage();
                finalY = 20; // Reset Y position to top of new page
              }

              // Add terms and conditions with consistent spacing
              newDoc.setFontSize(10);
              newDoc.setFont(undefined, 'bold');
              newDoc.text('Please Note Our Company Name:', 20, finalY + 20);
              newDoc.setFont(undefined, 'normal');
              newDoc.text(updatedCompanyNote, 20, finalY + 30);

              newDoc.setFont(undefined, 'bold');
              newDoc.text('Terms and Conditions:', 20, finalY + 45);
              newDoc.setFont(undefined, 'normal');

              // Add terms with proper spacing
              updatedTerms.forEach((term, index) => {
                const yPos = finalY + 55 + (index * 10);
                
                // Check if we need a new page for this term
                if (yPos > pageHeight - 50) { // Leave space for footer
                  newDoc.addPage();
                  finalY = 20 - 55 - (index * 10); // Reset Y position and adjust for current term position
                }
                
                newDoc.text(term, 20, yPos);
              });

              // Ensure footer is on the last page
              const lastPage = newDoc.internal.getNumberOfPages();
              newDoc.setPage(lastPage);
              newDoc.addImage(footerBase64, 'JPEG', 0, newDoc.internal.pageSize.height - 39, 210, 39);

              // Just open in new tab
              window.open(URL.createObjectURL(newDoc.output('blob')), '_blank');

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
                const message = `To ${companyName},<br><br>Please find attached your quotation.`;
                composeArea.innerHTML = message;
                composeArea.dispatchEvent(new Event('input', { bubbles: true }));

                await new Promise(resolve => setTimeout(resolve, 1000));

                const attachmentInput = document.querySelector('input[type="file"][name="Filedata"]');
                if (attachmentInput) {
                  const file = new File([newDoc.output('blob')], `quotation_${companyInput.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}.pdf`);
                  const dataTransfer = new DataTransfer();
                  dataTransfer.items.add(file);
                  attachmentInput.files = dataTransfer.files;
                  attachmentInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }

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
      args: [products, companyName, headerUrl, footerUrl, emailContent]
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

document.getElementById('item-form').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const itemData = {
        srNo: document.getElementById('sr-no').value,
        description: document.getElementById('description').value,
        make: document.getElementById('make').value,
        codeSize: document.getElementById('code-size').value,
        rate: document.getElementById('rate').value,
        remark: document.getElementById('remark').value
    };

    // Send message to parent window
    window.opener.postMessage({
        type: 'addItem',
        data: itemData
    }, '*');

    // Clear form
    this.reset();
    // Close popup
    window.close();
});

document.getElementById('cancel-btn').addEventListener('click', function() {
    window.close();
});