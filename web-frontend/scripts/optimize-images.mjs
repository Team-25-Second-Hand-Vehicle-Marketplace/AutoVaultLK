// One-off / re-run-as-needed: shrinks public/images/*.jpg to the size they are
// actually displayed at and re-compresses them. The source photos come
// straight out of an image generator at full resolution and ~85% quality,
// which is far more than any slot on the page needs - that's most of why
// they were slow to appear on first load.
import { readdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const DIR = fileURLToPath(new URL('../public/images/', import.meta.url))

// Target width = the largest the slot is ever rendered at (2x for retina),
// not the source's native resolution.
const TARGETS = {
  'hero-1': 2400,
  'hero-2': 2400,
  'hero-3': 2400,
  'auth-dealer': 1200,
  'cta-dealer': 2000,
  'cat-car': 1000,
  'cat-suv': 1000,
  'cat-bike': 1000,
  'cat-van': 1000,
  'cat-three-wheeler': 1000,
  'cat-pickup': 1000,
  'cat-lorry': 1000,
  'cat-other': 1000,
  'story-search': 1200,
  'story-verified': 1200,
  'story-drive': 1200,
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.jpg'))
let before = 0
let after = 0

for (const file of files) {
  const slot = file.replace(/\.jpg$/, '')
  const width = TARGETS[slot]
  if (!width) {
    console.warn(`skip ${file}: no target width configured`)
    continue
  }

  const path = join(DIR, file)
  const original = (await stat(path)).size
  const buffer = await sharp(path)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 68, mozjpeg: true, progressive: true })
    .toBuffer()

  before += original
  after += buffer.length
  // sharp/libvips can't reliably overwrite the file it just read on Windows;
  // write beside it and swap in.
  const tmp = `${path}.tmp`
  await sharp(buffer).toFile(tmp)
  await rename(tmp, path)
  console.log(
    `${file}: ${(original / 1024).toFixed(0)}KB -> ${(buffer.length / 1024).toFixed(0)}KB`,
  )
}

console.log(
  `\nTotal: ${(before / 1024 / 1024).toFixed(2)}MB -> ${(after / 1024 / 1024).toFixed(2)}MB`,
)
