Image processing — what exactly (given "not much")?

Your mentor said minimal, so this is deliberately small. The entire image work is:

✅ What you DO (only steps 3 & 4 are actually Sharp):


1. EXTRACT   pull images out of the uploaded ZIP           ← ZIP library (unzipper), NOT Sharp
2. MAP       match each image to its listing (by filename, e.g. TOYOTA_RAV4_001.jpg)  ← file handling, NOT Sharp
3. RESIZE    make 2 sizes: thumbnail (~300px) + full (~1280px)   ← SHARP
4. COMPRESS  reduce file size (.jpeg quality 80) so pages load fast  ← SHARP
5. STORE     upload the resized versions to S3, save the URLs on the listing  ← S3 SDK, NOT Sharp

So Sharp does ONLY the actual image transformation (resize + compress). The surrounding
steps are ZIP extraction, filename matching, and S3 upload — plain code, not Sharp.

That's it — a few sharp() calls:


sharp(input).resize(300).jpeg({quality:80}).toBuffer()   // thumbnail
sharp(input).resize(1280).jpeg({quality:82}).toBuffer()  // full