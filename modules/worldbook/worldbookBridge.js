// modules/worldbook/worldbookBridge.js — Main window side RPC service.
// Listens on BroadcastChannel('gf-worldbook-bridge') and serves requests
// from the standalone worldbook editor window.

import * as manager from '../worldbookManager.js';
import * as utils from '../utils.js';
import { characters } from '../../../../../../script.js';

const LOG = '[WorldBook Bridge]';
const CHANNEL_NAME = 'gf-worldbook-bridge';

let _channel = null;

export function initWorldbookBridge() {
    if (_channel) return;

    try {
        _channel = new BroadcastChannel(CHANNEL_NAME);
        _channel.onmessage = _handleMessage;
        console.log(`${LOG} Bridge initialized, listening on '${CHANNEL_NAME}'`);
    } catch (e) {
        console.warn(`${LOG} BroadcastChannel not available:`, e);
    }
}

// Push the init package to the editor window once it is ready.
export async function pushInitPackage() {
    if (!_channel) {
        console.warn(`${LOG} Bridge not initialized, cannot push init package`);
        return;
    }

    const payload = await _buildInitPayload();
    _channel.postMessage({ type: 'init', payload });
    console.log(`${LOG} Init package pushed`);
}

async function _buildInitPayload() {
    let allBookNames = [];
    let activeBooks = { global: [], character: [], charLore: [] };
    try { allBookNames = await manager.getAllBookNames(); } catch (e) { console.warn(`${LOG} getAllBookNames failed:`, e); }
    try { activeBooks = await manager.getActiveBooksGrouped(); } catch (e) { console.warn(`${LOG} getActiveBooksGrouped failed:`, e); }

    return {
        allBookNames,
        activeBooks,
        currentChar: _getCurrentCharInfo(),
        openedAt: Date.now(),
    };
}

function _getCurrentCharInfo() {
    try {
        const chid = utils.getCurrentChid();
        if (chid === null || chid === undefined) return null;
        const ch = characters?.[chid];
        if (!ch) return null;
        return {
            chid,
            name: ch.name || '',
            avatar: ch.avatar || '',
        };
    } catch (e) {
        return null;
    }
}

async function _handleMessage(event) {
    const { id, method, args } = event.data || {};
    if (!id || !method) return;

    console.log(`${LOG} RPC request: ${method} (${id})`);

    let result = null;
    let error = null;

    try {
        switch (method) {
            case 'ping': {
                result = { pong: true, echo: args ?? null, serverTime: Date.now() };
                break;
            }

            case 'listAllBooks': {
                result = await manager.getAllBookNames();
                break;
            }

            case 'getActiveBooks': {
                result = await manager.getActiveBooksGrouped();
                break;
            }

            case 'loadBook': {
                const name = args?.name;
                if (!name) throw new Error('loadBook: missing "name" arg');
                result = await manager.loadBook(name);
                break;
            }

            case 'getOccupancyMap': {
                const names = args?.bookNames;
                if (!Array.isArray(names)) throw new Error('getOccupancyMap: "bookNames" must be an array');
                result = await manager.getOccupancyMap(names);
                break;
            }

            case 'createEntry': {
                const bookName = args?.bookName;
                if (!bookName) throw new Error('createEntry: missing "bookName" arg');
                const partial = args?.partial && typeof args.partial === 'object' ? args.partial : {};
                result = await manager.createEntryInBook(bookName, partial);
                break;
            }

            case 'updateEntry': {
                const bookName = args?.bookName;
                const uid = args?.uid;
                const updates = args?.updates;
                if (!bookName) throw new Error('updateEntry: missing "bookName" arg');
                if (uid === undefined || uid === null) throw new Error('updateEntry: missing "uid" arg');
                if (!updates || typeof updates !== 'object') throw new Error('updateEntry: "updates" must be an object');
                result = await manager.updateEntryProperties(bookName, uid, updates);
                break;
            }

            case 'deleteEntry': {
                const bookName = args?.bookName;
                const uid = args?.uid;
                if (!bookName) throw new Error('deleteEntry: missing "bookName" arg');
                if (uid === undefined || uid === null) throw new Error('deleteEntry: missing "uid" arg');
                result = await manager.deleteEntryFromBook(bookName, uid);
                break;
            }

            default:
                error = `Unknown method: ${method}`;
                console.warn(`${LOG} ${error}`);
        }
    } catch (e) {
        error = e?.message || String(e);
        console.error(`${LOG} RPC error for ${method}:`, e);
    }

    if (_channel) {
        _channel.postMessage({ id, result, error });
    }
}
