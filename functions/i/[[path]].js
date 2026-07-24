import { serveR2Image } from '../../src/image-serving.js';

export async function onRequest(context) {
    const rawKey = new URL(context.request.url).pathname.slice('/i/'.length);
    return serveR2Image({
        request: context.request,
        env: context.env,
        rawKey
    });
}
