// Browser/Tauri builds have no Node "stream" module. xlsx-js-style probes for stream.Readable at load time
// (only used for Node streaming APIs we never call); this empty stand-in keeps the console clean.
export class Readable {}
export default { Readable };
