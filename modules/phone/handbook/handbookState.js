// modules/phone/handbook/handbookState.js
// Centralized state for the Handbook application

export const AppState = {
    channel: null,
    initData: null,
    meta: null,
    charId: null,

    // View state machine
    currentView: 'cover',    // 'cover' | 'coverEditor' | 'flyleaf' | 'diary'
    currentDiaryIndex: -1,   // -1 = new blank page, >=0 = existing page index

    // Bottom menu
    menuOpen: false,
    activeTab: 'search',

    // RPC
    pendingRpcCallbacks: new Map(),

    // Console log capture
    consoleLogs: [],

    // Cover image cache
    coverImageUrl: null,

    // Response cache for search
    responseCache: new Map(),

    // Custom background image cache
    bgImageCache: new Map(),

    // Sticker image URL cache: stickerId → objectURL
    stickerImageCache: new Map(),

    // Currently selected sticker (DOM element)
    selectedSticker: null,

    // Active sticker category filter in the menu tab
    activeStickerCategory: '__all__',

    // Tape image URL cache: tapeId → objectURL
    tapeImageCache: new Map(),

    // Active tape selection
    activeTapeId: null,
};
