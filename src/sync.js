const { join, posix, dirname } = require('path');
const fs = require('fs').promises;
const { URL } = require('url');
const { EventEmitter } = require('events');
const { getDocuments, getGoogleDocAsJson, getFileDetails } = require('./googleDrive.js');

const CACHE_DIRECTORY = process.env.CACHE_DIRECTORY || join(__dirname, '../cache');
const DOCS_DIRECTORY = process.env.DOCS_DIRECTORY || join(CACHE_DIRECTORY, 'docs');
const INDEX_PATH = join(CACHE_DIRECTORY, 'index.json');
const SYNC_INTERVAL_SECONDS = parseInt(process.env.GOOGLE_DRIVE_SYNC_INTERVAL_SECONDS, 10) || 60;

const syncEmitter = new EventEmitter();
let syncInProgress = false;

/**
 * Ensures that the necessary cache and pages directories exist.
 */
async function ensureDirectories() {
    await fs.mkdir(DOCS_DIRECTORY, { recursive: true });
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
        return JSON.parse(indexJson);
    } catch (error) {
        // If the file doesn't exist or is invalid, return an empty map.
        return {};
    }
}

/**
 * Checks if a file exists at the given path.
 * @param {string} filePath The path to the file.
 * @returns {Promise<boolean>} True if the file exists, false otherwise.
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
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
        const [remoteItems, localIndex] = await Promise.all([
            getDocuments(),
            getLocalIndex()
        ]);


        if (remoteItems.length === 0) {
            // If there are no remote items, we also clear the index.
            await fs.writeFile(INDEX_PATH, JSON.stringify({}, null, 2));
            console.log('No remote items found. Sync complete, index cleared.');
            syncEmitter.emit('syncComplete');
            return;
        }

        const newIndex = {};
        const itemMap = new Map(remoteItems.map(item => [item.id, item]));
        const rootParentId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        const pathCache = new Map(); // Memoization for path building

        // Function to build the full path for an item
        const buildPath = (itemId) => {
            if (pathCache.has(itemId)) {
                return pathCache.get(itemId);
            }
            const item = itemMap.get(itemId);
            if (!item) return ''; // Should not happen

            const slug = (item.name || 'untitled').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

            if (!item || !item.parents || item.parents[0] === rootParentId) {
                // Base case: item is in the root folder.
                const result = `/${slug}`;
                pathCache.set(itemId, result);
                return result;
            }

            const parentId = item.parents[0];
            const result = posix.join(buildPath(parentId), slug);
            pathCache.set(itemId, result);
            return result;
        };

        for (const remoteItem of remoteItems) {
            const isShortcut = remoteItem.mimeType === 'application/vnd.google-apps.shortcut';

            let itemToIndex = remoteItem;
            let downloadId = remoteItem.id;

            if (isShortcut) {
                const targetId = remoteItem.shortcutDetails?.targetId;
                let targetItem = itemMap.get(targetId);

                if (!targetItem) {
                    // Target is outside the scanned folder; fetch it directly.
                    console.log(`Shortcut target ${targetId} not in initial list, fetching directly...`);
                    targetItem = await getFileDetails(targetId);
                }

                if (!targetItem) {
                    console.warn(`Skipping broken shortcut: "${remoteItem.name}" (target ${targetId} not found).`);
                    continue;
                }
                // Use the shortcut's identity (name, parents) but the target's content (mimeType, modifiedTime)
                itemToIndex = {
                    ...remoteItem, // Start with shortcut's properties (id, name, parents)
                    mimeType: targetItem.mimeType, // Overwrite with target's mimeType
                    modifiedTime: targetItem.modifiedTime, // Overwrite with target's modifiedTime
                };
                downloadId = targetItem.id; // We download the target's content
            }

            const isTargetDoc = itemToIndex.mimeType === 'application/vnd.google-apps.document';
            const isTargetSheet = itemToIndex.mimeType === 'application/vnd.google-apps.spreadsheet';
            const isTargetFolder = itemToIndex.mimeType === 'application/vnd.google-apps.folder';

            // Continue if the resolved item is not a type we support
            if (!isTargetDoc && !isTargetSheet && !isTargetFolder) continue;

            const fullPath = buildPath(itemToIndex.id);

            newIndex[fullPath] = {
                id: downloadId, // The ID of the actual file to download/render
                name: itemToIndex.name, // Use the shortcut's name
                mimeType: itemToIndex.mimeType, // Use the target's mimeType
                modifiedTime: itemToIndex.modifiedTime, // Use the target's modifiedTime
                parent: itemToIndex.parents ? itemToIndex.parents[0] : null
            };

            const localItem = localIndex[fullPath];

            const localPath = join(DOCS_DIRECTORY, `${downloadId}.json`);
            const isMissingLocally = !(await fileExists(localPath));

            // Download if file is new or if modifiedTime has changed.
            if ((isTargetDoc || isTargetSheet) && (!localItem || itemToIndex.modifiedTime > localItem.modifiedTime || isMissingLocally)) {
                const reason = !localItem ? 'New' : (isMissingLocally ? 'Missing' : 'Updated');
                console.log(`Syncing: ${fullPath} (Reason: ${reason})`);

                if (isTargetDoc) {
                    const docJson = await getGoogleDocAsJson(downloadId);
                    await fs.writeFile(localPath, JSON.stringify(docJson, null, 2));
                } else if (isTargetSheet) {
                    const placeholder = {
                        ...itemToIndex,
                        message: "Google Sheet conversion is not yet implemented."
                    };
                    await fs.writeFile(localPath, JSON.stringify(placeholder, null, 2));
                }
            }
        }

        // --- Step 2: Prune local files that no longer exist in the remote index ---
        const requiredFileIds = new Set(Object.values(newIndex)
            .filter(item => item.mimeType !== 'application/vnd.google-apps.folder')
            .map(item => item.id));
        await pruneStaleFiles(requiredFileIds);

        await fs.writeFile(INDEX_PATH, JSON.stringify(newIndex, null, 2));
        console.log(`Sync complete. Indexed ${Object.keys(newIndex).length} paths.`);
        syncEmitter.emit('syncComplete');

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

/**
 * Deletes local files from the pages directory that no longer exist remotely.
 * @param {Set<string>} requiredFileIds - A set of all file IDs that should be kept.
 */
async function pruneStaleFiles(requiredFileIds) {
    console.log('Checking for stale files to remove...');
    let prunedCount = 0;
    try {
        const localFiles = await fs.readdir(DOCS_DIRECTORY);
        for (const localFile of localFiles) {
            if (!localFile.endsWith('.json')) continue;

            const fileId = localFile.replace('.json', '');
            if (!requiredFileIds.has(fileId)) {
                const localPath = join(DOCS_DIRECTORY, localFile);
                try {
                    await fs.unlink(localPath);
                    console.log(`Pruned stale file: ${localPath} (ID: ${fileId})`);
                    prunedCount++;
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        console.error(`Error pruning file ${localPath}:`, error);
                    }
                }
            }
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error reading pages directory for pruning:', error);
        }
        return;
    }

    if (prunedCount > 0) {
        console.log(`Pruned ${prunedCount} stale file(s).`);
    }
}

module.exports = { start, syncEmitter };