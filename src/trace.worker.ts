import { traceImage, type TraceInput } from './tracing';

self.onmessage = (event: MessageEvent<TraceInput>) => {
  try { self.postMessage({ result: traceImage(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Tracing failed.' }); }
};
