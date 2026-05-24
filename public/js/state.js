// 1. state.js: 전역 상태 변수 모음
window.ROOT_PATH = window.INITIAL_PATH || '';
window.currentPrefix = window.ROOT_PATH;
window.currentFileKey = '';

window.GLOBAL_ALIASES = {};
window.PROJECT_ALIASES = {};
window.TEMP_IMAGES = []; 

window.VIBE_IMAGE_FILE = null;
window.PRECISE_IMAGE_FILE = null;
window.INPAINT_IMAGE_FILE = null;
window.INPAINT_IMAGE_SOURCE = null;
window.INPAINT_IMAGE_OBJECT_URL = null;
window.INPAINT_MASK_READY = false;
window.INPAINT_DRAW_MODE = 'brush';
window.INPAINT_IS_DRAWING = false;
window.INPAINT_LAST_POINT = null;
window.EXTRA_CHAR_COUNT = 0;

window.GENERATION_QUEUE = [];
window.IS_GENERATING = false;
window.CANCEL_GENERATION = false;

window.FOLDER_DATA_CACHE = {};
window.IMPORT_BASE_PREFIX = '';
window.IMPORT_CURRENT_PREFIX = '';
window.INPAINT_LIBRARY_MODE = 'main';
window.INPAINT_LIBRARY_BASE_PREFIX = '';
window.INPAINT_LIBRARY_CURRENT_PREFIX = '';

window.CRAFT_ACTIVE_INDEX = null;
window.CRAFT_HISTORY_EXPANDED = false;
window.CRAFT_HISTORY_COLLAPSED = false;
window.PROJECT_PLANNER_META = null;

window.TEMP_FOLDER = '_temp_craft/';
window.PROMPT_IDS = ['prompt-style', 'prompt-composition', 'prompt-character', 'prompt-clothing', 'prompt-expression', 'prompt-action', 'prompt-background'];

window.galleryFileToUpload = null;
