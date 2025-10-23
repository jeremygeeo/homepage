const sanitizeHtml = require('sanitize-html');

/**
 * Sanitizes text content to prevent XSS.
 * It allows basic tags that we will re-apply, but escapes any raw HTML.
 * @param {string} text - The text to sanitize.
 * @returns {string} - The sanitized text.
 */
function sanitizeText(text) {
    // Basic configuration: remove all tags, but keep the content.
    return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
}

/**
 * Processes a single element's text run and applies styling.
 * @param {object} textRun - The textRun element from the Google Docs JSON.
 * @returns {string} - The processed HTML string for the text run.
 */
function processTextRun(textRun) {
  let textContent = sanitizeText(textRun.content).replace(/\n/g, '<br>');
  if (textRun.textStyle.bold) {
    textContent = `<strong>${textContent}</strong>`;
  }
  if (textRun.textStyle.italic) {
    textContent = `<em>${textContent}</em>`;
  }
  if (textRun.textStyle.underline) {
    textContent = `<u>${textContent}</u>`;
  }
  if (textRun.textStyle.strikethrough) {
    textContent = `<s>${textContent}</s>`;
  }
  // Handle links
  if (textRun.textStyle.link?.url) {
    textContent = `<a href="${textRun.textStyle.link.url}" target="_blank" rel="noopener noreferrer">${textContent}</a>`;
  }

  return textContent;
}

/**
 * Processes an inline image element.
 * @param {object} element - The inlineObjectElement from the Google Docs JSON.
 * @param {object} doc - The full Google Docs document JSON.
 * @returns {string} - The HTML <img> tag.
 */
function processImage(element, doc) {
  const { inlineObjectId } = element.inlineObjectElement;
  if (!doc.inlineObjects || !doc.inlineObjects[inlineObjectId]) {
    return '[Image not found]';
  }

  const image = doc.inlineObjects[inlineObjectId].inlineObjectProperties.embeddedObject;
  const imageProps = image.imageProperties;
  const imageUrl = imageProps?.contentUri;
  const altText = image.title || 'Embedded image';
  const description = image.description || '';

  if (imageUrl) {
    // Start with base responsive styles.
    let style = 'max-width: 100%; height: auto;';

    // Get dimensions from the doc. The unit is usually 'PT' (points).
    const width = imageProps?.width;
    const height = imageProps?.height;

    // If specific dimensions are set in the doc, apply them.
    if (width && width.magnitude && width.unit) {
      style += ` width: ${width.magnitude}${width.unit.toLowerCase()};`;
    }
    // The explicit height from the doc is often more accurate for aspect ratio.
    if (height && height.magnitude && height.unit) {
      style += ` height: ${height.magnitude}${height.unit.toLowerCase()};`;
    }

    return `<img src="${imageUrl}" alt="${altText}" title="${description}" style="${style}" />`;
  }
  return '[Unsupported image type]';
}

/**
 * Processes a table element.
 * @param {object} table - The table element from the Google Docs JSON.
 * @param {object} doc - The full Google Docs document JSON.
 * @returns {string} - The HTML <table> structure.
 */
function processTable(table, doc) {
  let tableHtml = '<table>';

  table.tableRows.forEach((row, rowIndex) => {
    tableHtml += '<tr>';
    const cellTag = (rowIndex === 0) ? 'th' : 'td';

    row.tableCells.forEach(cell => {
      // Cells can have properties like colspan and rowspan, which we can add later if needed.
      tableHtml += `<${cellTag}>`;

      // The content of a cell is an array of structural elements, similar to the main body.
      if (cell.content) {
        cell.content.forEach(cellElement => {
          if (cellElement.paragraph) {
            // We can reuse the paragraph processing logic.
            // For simplicity here, we'll just process the text runs.
            if (cellElement.paragraph.elements) {
              cellElement.paragraph.elements.forEach(element => {
                if (element.textRun) {
                  tableHtml += processTextRun(element.textRun);
                }
              });
            }
          }
        });
      }
      tableHtml += `</${cellTag}>`;
    });
    tableHtml += '</tr>';
  });

  tableHtml += '</table>';
  return tableHtml;
}

/**
 * Main function to convert Google Docs JSON to simple HTML.
 * @param {object} doc - The full Google Docs document JSON from the API.
 * @returns {string} - The generated HTML string.
 */
function convertDocsToHtml(doc) {
  if (!doc.body?.content) {
    return '';
  }

  let html = '';
  let listState = { currentListId: null, currentLevel: -1 };

  doc.body.content.forEach(structuralElement => {
    if (structuralElement.paragraph) {
      const paragraph = structuralElement.paragraph;
      const styleType = paragraph.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';

      // --- Handle lists ---
      if (paragraph.bullet) {
        const { listId, nestingLevel = 0 } = paragraph.bullet;

        if (listId !== listState.currentListId) {
          if (listState.currentListId) {
            for (let i = listState.currentLevel; i >= 0; i--) {
              html += '</ul>';
            }
          }
          listState.currentListId = listId;
          listState.currentLevel = -1;
        }

        if (nestingLevel > listState.currentLevel) {
          for (let i = listState.currentLevel; i < nestingLevel; i++) {
            html += '<ul>';
          }
        } else if (nestingLevel < listState.currentLevel) {
          for (let i = listState.currentLevel; i > nestingLevel; i--) {
            html += '</ul>';
          }
        }
        listState.currentLevel = nestingLevel;

        html += '<li>';
      } else {
        if (listState.currentListId) {
          for (let i = listState.currentLevel; i >= 0; i--) {
            html += '</ul>';
          }
          listState = { currentListId: null, currentLevel: -1 };
        }
      }

      // --- Handle headings and paragraphs ---
      const tagMap = {
        'TITLE': 'h1',
        'SUBTITLE': 'h2',
        'HEADING_1': 'h1',
        'HEADING_2': 'h2',
        'HEADING_3': 'h3',
        'HEADING_4': 'h4',
        'HEADING_5': 'h5',
        'HEADING_6': 'h6',
        'NORMAL_TEXT': 'p'
      };

      const tag = paragraph.bullet ? '' : `<${tagMap[styleType] || 'p'}>`;
      const closeTag = paragraph.bullet ? '</li>' : `</${tagMap[styleType] || 'p'}>`;
      
      if(tag) html += tag;

      // --- Process paragraph elements ---
      if (paragraph.elements) {
        paragraph.elements.forEach(element => {
          if (element.textRun) {
            html += processTextRun(element.textRun);
          } else if (element.inlineObjectElement) {
            html += processImage(element, doc);
          }
        });

        html += closeTag;
      }
    } else if (structuralElement.table) {
      html += processTable(structuralElement.table, doc);
    }
  });

  // Final check to close any remaining open lists
  if (listState.currentListId) {
    for (let i = listState.currentLevel; i >= 0; i--) {
      html += '</ul>';
    }
  }

  return html;
}

module.exports = { convertDocsToHtml };
