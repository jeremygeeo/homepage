const { google } = require('googleapis');

const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const GOOGLE_API_CREDENTIALS = process.env.GOOGLE_API_CREDENTIALS;

if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_API_CREDENTIALS) {
    console.warn('Google Drive integration is not configured. Please set GOOGLE_DRIVE_FOLDER_ID and GOOGLE_API_CREDENTIALS in your .env file.');
}

/**
 * Authorizes the service account to access Google APIs.
 * @returns {Promise<object>} An authorized JWT client.
 */
async function authorize() {
    if (!GOOGLE_API_CREDENTIALS) {
        throw new Error('GOOGLE_API_CREDENTIALS is not set.');
    }
    const credentials = JSON.parse(GOOGLE_API_CREDENTIALS);
    const auth = new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/documents.readonly']
    );
    await auth.authorize();
    return auth;
}

const drive = google.drive('v3');
const docs = google.docs('v1');

/**
 * Recursively lists all files in a given Google Drive folder.
 * @param {object} auth - The authorized Google API client.
 * @param {string} folderId - The ID of the folder to start from.
 * @returns {Promise<Array<object>>} A flat list of file objects.
 */
async function listFilesRecursive(auth, folderId) {
    let allItems = [];
    const foldersToProcess = [folderId];
    const processedFolders = new Set();

    while (foldersToProcess.length > 0) {
        const currentFolderId = foldersToProcess.pop();
        if (processedFolders.has(currentFolderId)) continue;
        processedFolders.add(currentFolderId);

        let pageToken = null;
        do {
            const res = await drive.files.list({
                auth,
                q: `'${currentFolderId}' in parents and trashed = false`,
                fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, parents, shortcutDetails(targetId), lastModifyingUser, webViewLink)',
                corpora: 'allDrives',
                includeItemsFromAllDrives: true,
                supportsAllDrives: true,
                pageToken: pageToken,
            });

            for (const file of res.data.files) {
                if (file.mimeType === 'application/vnd.google-apps.folder') {
                    foldersToProcess.push(file.id);
                }
                allItems.push(file);
            }
            pageToken = res.data.nextPageToken;
        } while (pageToken);
    }

    return allItems;
}

/**
 * Fetches all files and folders from the configured Google Drive folder.
 * @returns {Promise<Array<object>>} A raw list of all file and folder objects.
 */
async function getDocuments() {
    if (!GOOGLE_DRIVE_FOLDER_ID) {
        return [];
    }
    const auth = await authorize();
    return await listFilesRecursive(auth, GOOGLE_DRIVE_FOLDER_ID);
}

/**
 * Fetches the content of a Google Doc as JSON.
 * @param {string} documentId - The ID of the Google Doc.
 * @returns {Promise<object>} The Google Doc content as a JSON object.
 */
async function getGoogleDocAsJson(documentId) {
    const auth = await authorize();
    const res = await docs.documents.get({
        auth,
        documentId,
    });
    return res.data;
}

/**
 * Fetches the details for a single file by its ID.
 * @param {string} fileId - The ID of the file to fetch.
 * @returns {Promise<object>} The file object.
 */
async function getFileDetails(fileId) {
    const auth = await authorize();
    const res = await drive.files.get({
        auth,
        fileId,
        fields: 'id, name, mimeType, modifiedTime, parents, shortcutDetails(targetId), lastModifyingUser, webViewLink',
        supportsAllDrives: true,
    });
    return res.data;
}

/**
 * Fetches an image from a URL using the authorized Google client.
 * @param {string} imageUrl The URL of the image to fetch.
 * @returns {Promise<Buffer>} The image content as a Buffer.
 */
async function getGoogleImage(imageUrl) {
    const auth = await authorize();
    const res = await auth.request({
        url: imageUrl,
        responseType: 'arraybuffer' // Important to get binary data
    });
    // The data is returned as an ArrayBuffer, convert it to a Node.js Buffer
    return Buffer.from(res.data);
}


module.exports = {
    getDocuments,
    getGoogleDocAsJson,
    getFileDetails,
    getGoogleImage,
};