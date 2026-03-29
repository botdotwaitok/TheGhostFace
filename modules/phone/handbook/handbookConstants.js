// Ink colors — preset palette
export const PRESET_COLORS = [
    '#2c3e50', '#1a1a2e', '#5b2c6f', '#1e8449', '#c0392b', '#2874a6',
];

// Brush types config for UI
export const BRUSH_TYPES = [
    { id: 'pen',         icon: 'ph-pen',           label: '钢笔' },
    { id: 'marker',      icon: 'ph-marker-circle', label: '马克笔' },
    { id: 'highlighter', icon: 'ph-highlighter',   label: '荧光笔' },
    { id: 'calligraphy', icon: 'ph-pen-nib',       label: '书法笔' },
];

// Shape types config for UI
export const SHAPE_TYPES = [
    { id: 'rectangle', icon: 'ph-rectangle',     label: '矩形' },
    { id: 'ellipse',   icon: 'ph-circle',        label: '圆形' },
    { id: 'line',      icon: 'ph-line-segment',   label: '直线' },
    { id: 'arrow',     icon: 'ph-arrow-up-right', label: '箭头' },
];

// Response block style mapping — LLM toolbox
export const FONT_MAP = {
    'handwriting': "'Caveat', cursive",
    'chinese-hand': "'Long Cang', cursive",
    'elegant': "'Dancing Script', cursive",
    'default': "'Inter', 'Noto Sans SC', sans-serif",
};

export const COLOR_MAP = {
    'pink': '#e74c6a',
    'blue': '#2874a6',
    'purple': '#5b2c6f',
    'green': '#1e8449',
    'warm': '#d4a574',
    'dark': '#2c3e50',
};

export const SIZE_MAP = {
    'tiny': 12,
    'small': 14,
    'normal': 18,
    'large': 24,
    'huge': 32,
};

// Font presets for text tool (subset of diary fonts + handbook defaults)
export const TEXT_FONT_PRESETS = [
    { value: "'Inter', 'Noto Sans SC', sans-serif",    name: 'Inter (默认)',     loaded: true },
    { value: "'Long Cang', cursive",                   name: '龙藏 (手写)',      loaded: true },
    { value: "'Caveat', cursive",                       name: 'Caveat',          loaded: true },
    { value: "'Dancing Script', cursive",               name: 'Dancing Script',  loaded: true },
    { value: "'ZCOOL XiaoWei', cursive",                name: '小薇体',          loaded: false, url: 'https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&display=swap' },
    { value: "'Shadows Into Light', cursive",           name: 'Shadows',         loaded: false, url: 'https://fonts.googleapis.com/css2?family=Shadows+Into+Light&display=swap' },
];

export const TEXT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72];

// LocalStorage key for text tool preferences
export const HB_TEXT_PREFS_KEY = 'hb_text_tool_prefs';

// Cover color presets
export const COVER_PRESETS = [
    { name: '深海',   color: '#0f0c29' },
    { name: '玫瑰',   color: '#e74c6a' },
    { name: '森林',   color: '#134e5e' },
    { name: '暮色',   color: '#2c3e50' },
    { name: '暖阳',   color: '#f2994a' },
    { name: '薰衣草', color: '#c471ed' },
    { name: '夜空',   color: '#0c0c1d' },
    { name: '奶茶',   color: '#d4a574' },
];

// Tape presets (default washi tapes)
export const TAPE_PRESETS = [
    {
        id: 'tape-polka',
        name: '波点',
        url: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjZmNmM2Q5Ii8+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTAiIGZpbGw9IiNmMWI1NzYiIG9wYWNpdHk9IjAuOCIvPjwvc3ZnPg=='
    },
    {
        id: 'tape-stripes',
        name: '斜纹',
        url: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjZThmNGZkIiAvPjxwYXRoIGQ9Ik0wLDQwIEw0MCwwIE0tMTAsMTAgTDEwLC0xMCBNMzAsNTAgTDUwLDMwIiBzdHJva2U9IiNhM2NmZjQiIHN0cm9rZS13aWR0aD0iOCIgLz48L3N2Zz4='
    },
    {
        id: 'tape-grid',
        name: '大孔网格',
        url: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSIjZmRmZGZkIiBvcGFjaXR5PSIwLjkiLz48cGF0aCBkPSJNIDIwIDAgTCAwIDAgMCAyMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZGRkIiBzdHJva2Utd2lkdGg9IjEiLz48L3N2Zz4='
    }
];
