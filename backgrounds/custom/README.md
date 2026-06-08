# Custom Backgrounds

Place your custom background images in this folder.

## Required Files

You need to provide 4 directional background images:
- `north.png` - View looking north
- `east.png` - View looking east
- `south.png` - View looking south
- `west.png` - View looking west

## Image Specifications

- **Dimensions:** 1536 x 1024 pixels
- **Format:** PNG with transparency support
- **Orientation:** Each image should show the horizon/landscape as seen when facing that cardinal direction from your location

## Tips

- Include a horizon line in each image - the sun and moon will set behind it
- Keep the upper portion (sky area) relatively simple for aircraft visibility
- The bottom portion can have more detail (terrain, buildings, etc.)
- Consider your local landmarks and terrain for each direction

## Enabling Custom Theme

Set the theme in `config.json`:
```json
{
  "theme": "custom"
}
```

Then restart the server.
