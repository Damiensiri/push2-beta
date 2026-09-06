/* Local photo preparation: no original photo is sent to a conversion service. */
(function () {
  'use strict';
  const MAX_INPUT = 20 * 1024 * 1024;
  const MAX_OUTPUT = 3 * 1024 * 1024;
  async function prepare(file) {
    if (!file || !file.size) throw Error('Choisissez une photo non vide.');
    if (file.size > MAX_INPUT) throw Error('Choisissez une photo de 20 Mo maximum.');
    const heic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|hei[cf])$/i.test(file.name || '')) {
      throw Error('Choisissez une photo JPEG, PNG, WebP ou HEIC.');
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    const canvas = document.createElement('canvas');
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error(heic
          ? 'Ce navigateur ne peut pas lire cette photo HEIC. Ouvrez la PWA dans Safari sur un iPhone à jour, ou choisissez une version JPEG.'
          : 'Cette photo ne peut pas être lue. Choisissez une autre image.'));
        image.src = url;
      });
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height) throw Error('Cette photo est illisible.');
      let scale = Math.min(1, 1600 / Math.max(width, height));
      for (let attempt = 0; attempt < 4; attempt++) {
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw Error('Impossible de préparer la photo sur cet appareil.');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .85 - attempt * .1));
        if (blob && blob.size > 0 && blob.size <= MAX_OUTPUT && blob.type === 'image/jpeg') return blob;
        scale *= .75;
      }
      throw Error('Impossible de compresser cette photo. Choisissez une autre image.');
    } finally {
      URL.revokeObjectURL(url);
      image.src = '';
      canvas.width = canvas.height = 0;
    }
  }
  globalThis.HorsePhoto = {prepare};
})();
