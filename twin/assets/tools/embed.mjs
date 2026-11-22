// Re-pack a GLB that references external textures into a self-contained GLB. Usage: node embed.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [a, b] = process.argv.slice(2); const doc = await io.read(a);
for (const t of doc.getRoot().listTextures()) t.setURI('');
await io.write(b, doc);
