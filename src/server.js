require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { convertDocsToHtml } = require('./googleDocsToHtml.js');
const { formatTimeAgo } = require('./utils.js');
const { start: startSyncService, syncEmitter } = require('./sync.js');

const app = express();
const PORT = process.env.PORT || 3000;
const LISTEN_IP = process.env.LISTEN_IP || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || `http://${LISTEN_IP}:${PORT}`;
const TEMPLATES_DIRECTORY = process.env.TEMPLATES_DIRECTORY || path.join(__dirname, '../templates');
const CACHE_DIRECTORY = process.env.CACHE_DIRECTORY || path.join(__dirname, '../cache');
const PUBLIC_DIRECTORY = process.env.PUBLIC_DIRECTORY || path.join(__dirname, '../public');
const DOCS_DIRECTORY = process.env.DOCS_DIRECTORY || path.join(CACHE_DIRECTORY, 'docs');
const INDEX_PATH = path.join(CACHE_DIRECTORY, 'index.json');

// Serve static files from the 'public' directory
app.use(express.static(PUBLIC_DIRECTORY));

let pathIndex = {};

/**
 * Loads the path index from the cache file.
 */
async function loadPathIndex() {
    try {
        const indexJson = await fs.readFile(INDEX_PATH, 'utf8');
        pathIndex = JSON.parse(indexJson);
        console.log('Path index loaded into memory.');
    } catch (error) {
        console.error(`Could not load or parse ${INDEX_PATH}. Waiting for sync.`, error);
        pathIndex = {};
    }
}

// Listen for the sync completion event to reload the index
syncEmitter.on('syncComplete', () => {
    console.log('Sync complete event received. Reloading path index...');
    loadPathIndex();
});

/**
 * Builds a hierarchical navigation tree from the flat pathIndex.
 * @param {object} pathIndex - The flat index of site paths.
 * @returns {Array<object>} A hierarchical array of navigation nodes.
 */
function buildNavTree(pathIndex) {
    const nodes = {};
    const tree = [];

    // Create nodes for all paths
    for (const [fullPath, item] of Object.entries(pathIndex)) {
        if (fullPath === '/') continue; // Skip the root folder itself

        nodes[fullPath] = {
            name: item.name,
            path: item.mimeType === 'application/vnd.google-apps.folder' ? `${fullPath}/` : fullPath,
            children: []
        };
    }

    // Build the hierarchy
    for (const fullPath of Object.keys(nodes)) {
        const parentDir = path.dirname(fullPath);
        if (parentDir === '/') {
            tree.push(nodes[fullPath]);
        } else if (nodes[parentDir]) {
            nodes[parentDir].children.push(nodes[fullPath]);
        }
    }

    // Helper to sort children recursively
    const sortChildren = (node) => {
        // Sort by folders first, then by name
        node.children.sort((a, b) => {
            const aIsFolder = a.children.length > 0;
            const bIsFolder = b.children.length > 0;
            if (aIsFolder !== bIsFolder) {
                return aIsFolder ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        node.children.forEach(sortChildren);
    };

    // Sort the root level and all children
    tree.sort((a, b) => {
        const aIsFolder = a.children.length > 0;
        const bIsFolder = b.children.length > 0;
        if (aIsFolder !== bIsFolder) {
            return aIsFolder ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
    tree.forEach(sortChildren);

    return tree;
}

/**
 * Renders a directory listing page.
 */
async function renderDirectory(req, res, currentPath) {
    try {
        const templateHtml = await fs.readFile(path.join(TEMPLATES_DIRECTORY, 'index.html'), 'utf8');
        
        const children = Object.entries(pathIndex).filter(([childPath, item]) => {
            // Find items that are direct children of the current path
            const parentDir = path.dirname(childPath);
            if (currentPath === '/') {
                // For the root, the parent directory of a child must also be the root.
                return parentDir === '/';
            }
            return parentDir === currentPath;
        });

        // Separate directories and files
        const directories = children.filter(([, item]) => item.mimeType === 'application/vnd.google-apps.folder');
        const files = children.filter(([, item]) => item.mimeType !== 'application/vnd.google-apps.folder');

        // Sort directories and files alphabetically
        directories.sort(([pathA], [pathB]) => pathA.localeCompare(pathB));
        files.sort(([pathA], [pathB]) => pathA.localeCompare(pathB));

        let tableRowsHtml = '';

        // Add a "back to parent" link if not in the root directory
        if (currentPath !== '/') {
            const parentPath = path.dirname(currentPath);
            // The link should always end with a slash for a directory
            const parentLink = parentPath === '/' ? '/' : `${parentPath}/`;
            // Get the parent's name. If the parent is the root, use a generic name like "Home".
            const parentName = parentPath === '/' ? 'Home' : (pathIndex[parentPath]?.name || '..');

            tableRowsHtml += `
                <tr>
                    <td><img src="/icons/up.svg" alt="Up" class="file-icon"></td>
                    <td><a href="${parentLink}">(Back to ${parentName})</a></td>
                    <td></td>
                </tr>`;
        }

        if (children.length === 0) {
            tableRowsHtml += '<tr><td colspan="3">This directory is empty.</td></tr>';
        } else {
            // Render directories first
            directories.forEach(([dirPath, dirItem]) => {
                tableRowsHtml += `
                    <tr>
                        <td><img src="/icons/folder.svg" alt="Folder" class="file-icon"></td>
                        <td><a href="${dirPath}/">${dirItem.name}/</a></td>
                        <td>${formatTimeAgo(dirItem.modifiedTime)}</td>
                    </tr>`;
            });
            // Render files
            files.forEach(([filePath, fileItem]) => {
                const icon = fileItem.mimeType.includes('spreadsheet') ? 'sheet.svg' : 'doc.svg';
                tableRowsHtml += `
                    <tr>
                        <td><img src="/icons/${icon}" alt="File" class="file-icon"></td>
                        <td><a href="${filePath}">${fileItem.name}</a></td>
                        <td>${formatTimeAgo(fileItem.modifiedTime)}</td>
                    </tr>`;
            });
        }

        const finalHtml = templateHtml.replace('<!-- FILE_LIST -->', tableRowsHtml);
        res.setHeader('Content-Type', 'text/html');
        res.send(finalHtml);

    } catch (error) {
        console.error(`Error rendering directory for ${currentPath}:`, error);
        res.status(500).send('<h1>500 - Internal Server Error</h1>');
    }
}

/**
 * Renders a single document page.
 */
async function renderFile(req, res, item) {
    const docPath = path.join(DOCS_DIRECTORY, `${item.id}.json`);

    try {
        await fs.access(docPath);
        const [docJsonRaw, templateHtml] = await Promise.all([
            fs.readFile(docPath, 'utf8'),
            fs.readFile(path.join(TEMPLATES_DIRECTORY, 'docs.html'), 'utf8')
        ]);

        const docJson = JSON.parse(docJsonRaw);
        const contentHtml = convertDocsToHtml(docJson);

        // Build header
        const modifiedDate = new Date(item.modifiedTime).toLocaleString();
        const modifierName = item.lastModifyingUser?.displayName || 'Unknown User';
        const docHeaderHtml = `
            <strong>${modifierName}</strong> on ${modifiedDate}
        `;

        // Build footer
        const docFooterHtml = `
            <a href="${item.webViewLink}" target="_blank" rel="noopener noreferrer"><code>${req.path}</code></a>
        `;

        const finalHtml = templateHtml
            .replace('<!-- DOC_HEADER -->', docHeaderHtml)
            .replace('<!-- CONTENT -->', contentHtml)
            .replace('<!-- DOC_FOOTER -->', docFooterHtml);

        res.setHeader('Content-Type', 'text/html');
        res.send(finalHtml);
    } catch (error) {
        console.error(`Error rendering file ${item.name} (ID: ${item.id}):`, error);
        res.status(500).send('<h1>500 - Error Rendering File</h1><p>The file exists in the index but could not be rendered. It may still be syncing.</p>');
    }
}

// API endpoint for navigation
app.get('/api/nav', (req, res) => {
    const navTree = buildNavTree(pathIndex);
    res.json(navTree);
});

// Universal route to handle all requests
app.get('*', async (req, res) => {
    let reqPath = path.normalize(req.path);

    // If root, treat as directory
    if (reqPath === '/' || reqPath === '/index.html') {
        return renderDirectory(req, res, '/');
    }

    // Check if it's a directory request (ends with /)
    if (reqPath.endsWith('/') && reqPath.length > 1) {
        const dirPath = reqPath.slice(0, -1); // Remove trailing slash for lookup
        if (pathIndex[dirPath] && pathIndex[dirPath].mimeType === 'application/vnd.google-apps.folder') {
            return renderDirectory(req, res, dirPath);
        }
    } else { // It's a file request (or a directory request missing a slash)
        const item = pathIndex[reqPath];
        if (item && item.mimeType !== 'application/vnd.google-apps.folder') {
            return renderFile(req, res, item);
        }
        // If it wasn't a file, check if it's a directory that needs a redirect
        if (pathIndex[reqPath] && pathIndex[reqPath].mimeType === 'application/vnd.google-apps.folder') {
            const newUrl = new URL(req.originalUrl + '/', BASE_URL);
            return res.redirect(301, newUrl.href);
        }
    }

    // If we get here, nothing was found
    console.warn(`404 - Path not found in index: ${reqPath}`);
    res.status(404).send(`<h1>404 - Not Found</h1><p>The path "${req.path}" could not be found.</p>`);
});

app.listen(PORT, LISTEN_IP, async () => {
    // Start the sync service and wait for the *first* sync to complete
    // before loading the index and starting the server.
    console.log('Performing initial data sync before starting server...');
    await startSyncService();

    console.log(`Server is running on http://${LISTEN_IP}:${PORT}`);
    console.log(`Serving docs from: ${DOCS_DIRECTORY}`);
    console.log(`Serving static assets from: ${PUBLIC_DIRECTORY}`);
    console.log(`Using templates from: ${TEMPLATES_DIRECTORY}`);
});
