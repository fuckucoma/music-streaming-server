
require('dotenv').config();

console.log('DATABASE_URL:', process.env.DATABASE_URL);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function main() {
  const files = fs.readdirSync('./tracks');

  for (const file of files) {
    const [artist, titleWithExtension] = file.split(' - ');
    const title = titleWithExtension.replace('.mp3', '');

    await prisma.track.create({
      data: {
        title: title.trim(),
        artist: artist.trim(),
        filename: file,
      },
    });
  }

  console.log('Треки успешно добавлены в базу данных.');
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
