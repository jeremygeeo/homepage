const path = require('path');
const fs = require('fs').promises;
const { getDocuments, getGoogleDocAsJson } = require('./googleDrive.js');

const PAGES_DIRECTORY = process.env.PAGES_DIRECTORY || path.join(__dirname, '../pages');
const CACHE_DIRECTORY = process.env.CACHE_DIRECTORY || path.join(__dirname, '../cache');
const INDEX_PATH = path.join(CACHE_DIRECTORY, 'index.json');
const SYNC_INTERVAL_SECONDS = parseInt(process.env.GOOGLE_DRIVE_SYNC_INTERVAL_SECONDS, 10) || 60;

let syncInProgress = false;

/**
 * Ensures that the necessary cache and pages directories exist.
 */
async function ensureDirectories() {
    await fs.mkdir(PAGES_DIRECTORY, { recursive: true });
    await fs.mkdir(CACHE_DIRECTORY, { recursive: true });
}

/**
 * Reads the local file index from cache/index.json.
 * @returns {Promise<Map<string, object>>} A map of locally indexed files.
 */
async function getLocalIndex() {
    try {
        await fs.access(INDEX_PATH);
        const indexJson = await fs.readFile(INDEX_PATH, 'utf8');
        // The stored format is an array of [key, value] pairs
        return new Map(JSON.parse(indexJson));
    } catch (error) {
        // If the file doesn't exist or is invalid, return an empty map.
        return new Map();
    }
}

/**
 * The main synchronization function. Fetches remote files, compares with local
 * index, and downloads new or updated files.
 */
async function syncFiles() {
    if (syncInProgress) {
        console.log('Sync is already in progress. Skipping this run.');
        return;
    }

    syncInProgress = true;
    console.log('Starting Google Drive sync...');

    try {
        const [remoteFiles, localIndex] = await Promise.all([
            getDocuments(),
            getLocalIndex()
        ]);

        for (const [name, remoteFile] of remoteFiles.entries()) {
            const localFile = localIndex.get(name);

            // Download if file is new or if modifiedTime has changed.
            if (!localFile || remoteFile.modifiedTime > localFile.modifiedTime) {
                console.log(`Syncing: ${name} (Reason: ${!localFile ? 'New' : 'Updated'})`);

                if (remoteFile.mimeType === 'application/vnd.google-apps.document') {
                    const docJson = await getGoogleDocAsJson(remoteFile.id);
                    const localPath = path.join(PAGES_DIRECTORY, `${name}.json`);
                    await fs.writeFile(localPath, JSON.stringify(docJson, null, 2));
                } else if (remoteFile.mimeType === 'application/vnd.google-apps.spreadsheet') {
                    // For now, just create a placeholder file to track it.
                    // This can be expanded later to download CSV or JSON data.
                    const placeholder = {
                        id: remoteFile.id,
                        name: remoteFile.name,
                        modifiedTime: remoteFile.modifiedTime,
                        message: "Google Sheet conversion is not yet implemented."
                    };
                    const localPath = path.join(PAGES_DIRECTORY, `${name}.json`);
                    await fs.writeFile(localPath, JSON.stringify(placeholder, null, 2));
                }
            }
        }

        // Update the local index with the latest remote file list
        // We convert the Map to an Array for JSON serialization
        await fs.writeFile(INDEX_PATH, JSON.stringify(Array.from(remoteFiles.entries()), null, 2));
        console.log(`Sync complete. Found ${remoteFiles.size} remote files.`);

    } catch (error) {
        console.error('An error occurred during Google Drive sync:', error);
    } finally {
        syncInProgress = false;
        // Schedule the next sync
        setTimeout(runSync, SYNC_INTERVAL_SECONDS * 1000);
        console.log(`Next sync scheduled in ${SYNC_INTERVAL_SECONDS} seconds.`);
    }
}

/**
 * A wrapper function to start the sync process.
 */
async function runSync() {
    await syncFiles();
}

/**
 * Initializes the sync service.
 */
async function start() {
    await ensureDirectories();
    // Run the first sync immediately on startup.
    // Subsequent runs will be scheduled by syncFiles().
    await runSync();
}

module.exports = { start };