// 1. state.js: 전역 상태 변수 모음
window.ROOT_PATH = window.INITIAL_PATH || '';
window.currentPrefix = window.ROOT_PATH;
window.currentFileKey = '';

window.GLOBAL_ALIASES = {};
window.PROJECT_ALIASES = {};
window.TEMP_IMAGES = []; 

window.VIBE_IMAGE_FILE = null;
window.PRECISE_IMAGE_FILE = null;
window.EXTRA_CHAR_COUNT = 0;

window.GENERATION_QUEUE = [];
window.IS_GENERATING = false;
window.CANCEL_GENERATION = false;

window.FOLDER_DATA_CACHE = {};
window.IMPORT_BASE_PREFIX = '';
window.IMPORT_CURRENT_PREFIX = '';

window.CRAFT_ACTIVE_INDEX = null;
window.CRAFT_HISTORY_EXPANDED = false;

window.TEMP_FOLDER = '_temp_craft/';
window.PROMPT_IDS = ['prompt-style', 'prompt-composition', 'prompt-character', 'prompt-clothing', 'prompt-expression', 'prompt-action', 'prompt-background'];

window.galleryFileToUpload = null;