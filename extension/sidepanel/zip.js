// DDinspect - minimal ZIP writer.
// Stores files without compression (images and fonts are already compressed),
// which keeps it tiny and dependency-free. Exposed as globalThis.DDinspectZip.

(() => {
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  // files: [{ name: string, data: Uint8Array }] → Blob (application/zip)
  function createZip(files) {
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime(new Date());
    const UTF8_NAMES = 0x0800;
    const parts = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const crc = crc32(file.data);
      const size = file.data.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);  // local file header signature
      local.setUint16(4, 20, true);          // version needed
      local.setUint16(6, UTF8_NAMES, true);
      local.setUint16(8, 0, true);           // method: stored
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);       // compressed size
      local.setUint32(22, size, true);       // uncompressed size
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);          // extra field length
      parts.push(new Uint8Array(local.buffer), name, file.data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);  // central directory signature
      entry.setUint16(4, 20, true);          // version made by
      entry.setUint16(6, 20, true);          // version needed
      entry.setUint16(8, UTF8_NAMES, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, size, true);
      entry.setUint32(24, size, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);     // local header offset (other fields stay 0)
      central.push(new Uint8Array(entry.buffer), name);

      offset += 30 + name.length + size;
    }

    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);      // end of central directory signature
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  globalThis.DDinspectZip = { createZip, crc32 };
})();
