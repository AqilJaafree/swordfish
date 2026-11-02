# Swordfish titanium hero

Original procedural artwork built from the site's Swordfish SVG silhouette. The layered body uses a folded titanium face, a blue edge channel, graphite internals, and a machined circular substrate. A studio camera and moving softbox reveal the layers over a seamless eight-second assembly cycle.

- `swordfish-titanium.blend`: editable scene, camera, materials, and animation.
- `build_scene.py`: regenerates the scene and its animation. No external models or textures.
- Public delivery: `public/landing-media/hero.mp4` and `hero-poster.jpg`.

Built with Blender 5.2.3, Eevee ray tracing, 64 temporal samples, 1536 × 960 at 24 fps. Frames 1–192 form the loop; frame 193 matches the opening pose.

From the repository root, render with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 8 --python design/metallic-hero/build_scene.py
```

Append `-- --preview` to render two smaller test views. Full frames are written to `/tmp/swordfish-metallic/frames/`; encode them with FFmpeg using `-framerate 24 -i frame_%04d.png -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart`. The page serves an MP4 for native browser decoding and a still poster for loading, reduced motion, and no-JavaScript fallback.
