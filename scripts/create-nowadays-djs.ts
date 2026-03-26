/**
 * Script to create pending DJ profiles for Nowadays NYC resident DJs
 *
 * Run with: npx tsx scripts/create-nowadays-djs.ts
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load production env vars for Firebase Admin credentials
dotenv.config({ path: resolve(__dirname, '../.env.production') });

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (!privateKey || !clientEmail || !projectId) {
    console.error('Missing Firebase Admin credentials in .env.production');
    process.exit(1);
  }

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.includes('\\n')
        ? privateKey.replace(/\\n/g, '\n')
        : privateKey,
    }),
  });
}

const db = getFirestore();

interface DJData {
  username: string;
  bio: string;
  photoUrl: string;
  location: string;
  socialLinks: {
    soundcloud?: string;
    youtube?: string;
    customLinks?: { label: string; url: string }[];
  };
}

const nowadaysDJs: DJData[] = [
  {
    username: 'Avalon Emerson',
    bio: 'Now one of dance music\'s most respected DJs, Avalon Emerson first made a name for herself in the storied warehouse scene of her birthplace, San Francisco, before relocating to Berlin in 2013.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2023/11/Avalon-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      soundcloud: 'https://soundcloud.com/avalonemerson',
      customLinks: [
        { label: 'Live At Mutek Mexico', url: 'https://soundcloud.com/avalonemerson/mutek-mexico' },
        { label: 'Essential Mix', url: 'https://soundcloud.com/avalonemerson/essential-mix' },
      ],
    },
  },
  {
    username: 'Aurora Halal',
    bio: 'Aurora Halal is an artist whose work creates worlds. She\'s been making magic in the NYC underground since 2010.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2019/01/Aurora-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Resident Advisor', url: 'https://soundcloud.com/resident-advisor/ra681-aurora-halal' },
        { label: 'Phonica', url: 'https://soundcloud.com/phonicarecords/phonica-mix-series-134-aurora-halal' },
      ],
    },
  },
  {
    username: 'Ayesha',
    bio: 'Ayesha is a key player in Brooklyn\'s dance music scene, and has become one of NYC\'s most prominent names when it comes to faster, more bass-heavy sounds.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2022/09/Ayesha.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Live at Fourth World', url: 'https://soundcloud.com/aye5ha/ayesha-fw2k22' },
        { label: 'LT Podcast', url: 'https://soundcloud.com/lobster-theremin/lt-podcast-194-ayesha' },
      ],
    },
  },
  {
    username: 'Batu',
    bio: 'Known for his distinctive slant on modernist techno and experimental club music, Batu has built a sound defined by bold shapes, percussive rhythms and meticulous sonic detail.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2026/01/Batu1-995x1500.jpg',
    location: 'New York',
    socialLinks: {
      soundcloud: 'https://soundcloud.com/batuuk',
      customLinks: [
        { label: 'Mixmag', url: 'https://soundcloud.com/mixmag-1/the-cover-mix-batu' },
        { label: 'Live @ Nowadays', url: 'https://soundcloud.com/batuuk/batu-nowadays-nonstop-nyc-16th-feb-2025' },
      ],
    },
  },
  {
    username: 'Binh',
    bio: 'Born in Düsseldorf and now based in Berlin, Binh has been digging deep into music for over two decades. His obsession with under-the-radar records defines a DJ style that\'s both unique and widely respected.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2026/01/Binh-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Resident Advisor', url: 'https://soundcloud.com/resident-advisor/ra-989-binh' },
        { label: 'Live at Houghton', url: 'https://soundcloud.com/houghton-festival/recorded-at-houghton-binh-2023' },
      ],
    },
  },
  {
    username: 'Eamon Harkin',
    bio: 'Eamon Harkin is one half of the partnership behind Mister Saturday Night, Mister Sunday, Planetarium and Nowadays — a constellation of projects rooted in the belief that music can bind strangers.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2019/01/Eamon.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Live @ Waking Life', url: 'https://soundcloud.com/mistersaturdaynight/eamon-harkin-at-waking-life-june-21st-2024' },
        { label: 'Juanita\'s', url: 'https://soundcloud.com/juanitasnyc/juanitas-mix-084-eamon-harkin' },
      ],
    },
  },
  {
    username: 'Honey Bun',
    bio: 'Honey Bun is a New York City-born interdisciplinary Afro-futurist artist with an omnivorous and expansive taste that is at once sensual, adventurous, and playful.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2025/01/Honey-Bun-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Deep South', url: 'https://soundcloud.com/deepsouthatl/deep-south-podcast-147-honeybun' },
        { label: 'Coloring Lessons', url: 'https://soundcloud.com/coloringlessons/coloring-lessons-mix-series-047-honey-bun' },
      ],
    },
  },
  {
    username: 'Introspekt',
    bio: 'Introspekt is an contemporary club icon, afrofuturist, producer, DJ, sensual provocateur, roots of dubstep recontextualiser.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2026/01/Introspekt-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Live at Fabric', url: 'https://soundcloud.com/fabric/026-instrospekt-recorded-live-from-fabric' },
        { label: 'Mixmag', url: 'https://soundcloud.com/mixmag-1/the-mix-032-introspekt' },
      ],
    },
  },
  {
    username: 'Justin Carter',
    bio: 'Justin Carter is an artist, musician and DJ as well as the co-founder of Nowadays, the Planetarium deep listening series.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2026/01/Justin-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Melbourne Deepcast', url: 'https://soundcloud.com/melbourne-deepcast/mdc295-justin-carter' },
        { label: 'Live @ Nowadays', url: 'https://soundcloud.com/mistersaturdaynight/how-i-build-a-floor-justin-carter-at-mister-sunday-july-20-2025' },
      ],
    },
  },
  {
    username: 'Kia',
    bio: 'Kia is a DJ, curator, and label boss with a gift for weaving atmospheric, psychedelic sounds that create immersive, pulsating worlds.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2025/01/Kia-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Monument', url: 'https://soundcloud.com/monument-podcast/mnmt-422-kia' },
        { label: 'Dekmantel', url: 'https://soundcloud.com/dkmntl/dekmantel-podcast-440-kia' },
      ],
    },
  },
  {
    username: 'Kilopatrah Jones',
    bio: 'Born and raised in Queens, a city dweller and a club kid, Kilopatrah has an innate and superlative gift for transferring energy from the booth to the dance floor.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2026/01/Kilopatra-Jones-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Resident Advisor', url: 'https://soundcloud.com/resident-advisor/ra-1013-kilopatrah-jones' },
        { label: 'Is Burning', url: 'https://soundcloud.com/isburning/kilopatrah-jones-isburning-128' },
      ],
    },
  },
  {
    username: 'livwutang',
    bio: 'Since emerging from Seattle\'s eclectic DIY scene, livwutang has established herself as one of dance music\'s most singular yet versatile voices.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2023/01/Liv-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Live at Sustain-Release', url: 'https://soundcloud.com/resident-advisor/ra681-aurora-halal' },
        { label: 'Dekmantel', url: 'https://soundcloud.com/dkmntl/dekmantel-podcast-413-livwutang' },
      ],
    },
  },
  {
    username: 'Matas',
    bio: 'Matas is a New York City-based DJ who, over the past decade, has worked in many different avenues of dance music – record shops, DIY parties, festivals, clubs.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2026/01/Matas-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Live at Earth Dog', url: 'https://soundcloud.com/earthdogbk/ed050-matas-earth-dog-march-01-2025' },
        { label: 'Live at Nowadays', url: 'https://soundcloud.com/animalia-label/anilive-forty-nine-matas-nowadays' },
      ],
    },
  },
  {
    username: 'MORENXXX',
    bio: 'DJ, producer, and antidisciplinary artist MORENXXX—also known as Jesús Hilario Reyes—is a true enigmatic force exalted from Chicago\'s underground.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2025/01/MORENXXX-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      soundcloud: 'https://soundcloud.com/morenxxx',
      customLinks: [
        { label: 'Live at Nowadays', url: 'https://soundcloud.com/morenxxx/morenxxx-nowadays-nonstop-111024' },
        { label: 'Live at Sustain-Release', url: 'https://soundcloud.com/morenxxx/morenxxx-sustain-release-year-9' },
      ],
    },
  },
  {
    username: 'OK Williams',
    bio: 'OK Williams fearlessly keeps the dance floor on its toes. The London DJ is known for her high energy club sets which masterfully travel through genres.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2023/11/OK-Williams-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      soundcloud: 'https://soundcloud.com/okwilliams',
      customLinks: [
        { label: 'NTS Radio', url: 'https://soundcloud.com/user-612196404/ok-williams-170823' },
      ],
    },
  },
  {
    username: 'Powder',
    bio: 'The shorter and more vague a word is, the more direct its physical meaning becomes. Powder\'s DJ sets and music consistently hold this feeling.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2025/01/Powder.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Resident Advisor', url: 'https://soundcloud.com/resident-advisor/ra700-powder' },
        { label: 'Sustain-Release', url: 'https://soundcloud.com/sustain-release-nyc/powder-sustain-release-2017' },
      ],
    },
  },
  {
    username: 'RHR',
    bio: 'Influenced by the raucous rhythms and powerful percussion of the São Paulo ghettos, RHR has been quietly honing his craft as a producer and DJ in Brazil since 2010.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2025/01/RHR_website-1-1406x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Unsound', url: 'https://soundcloud.com/unsound/unsound-podcast-105-rhr' },
        { label: 'Gop Tun', url: 'https://soundcloud.com/goptun/rhr-gop-tun-festival-2022' },
      ],
    },
  },
  {
    username: 'Theo Parrish',
    bio: 'Theo Parrish is a Washington D.C.-born, Chicago-raised DJ, producer, selector, arranger, keyboard clunker, machine beater, writer, sculptor, car lover.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2023/11/Theo.jpg',
    location: 'New York',
    socialLinks: {
      youtube: 'https://www.youtube.com/watch?v=p423kZ_cXnE',
      customLinks: [
        { label: 'Live At Nowadays', url: 'https://www.youtube.com/watch?v=p423kZ_cXnE' },
        { label: 'Live In Detroit', url: 'https://www.youtube.com/watch?v=7K6WS6Vo3vA' },
      ],
    },
  },
  {
    username: 'Vladimir Ivkovic',
    bio: 'Vladimir Ivkovic is a DJ blessed with a particularly unique talent for selecting records and weaving them into a larger narrative.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2025/01/Vlad.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Live @ The White Hotel', url: 'https://soundcloud.com/bakkheia_records/bakk-heia-podcast-no1-vladimir-ivkovic-live-at-the-white-hotel' },
        { label: 'Live @ Solstice', url: 'https://soundcloud.com/postbar/vladimir-ivkovic-at-solstice-2022' },
      ],
    },
  },
  {
    username: 'x3butterfly',
    bio: 'x3butterfly is a Mexican-American DJ and producer native to Detroit with a background in experimental performance art and interdisciplinary studies.',
    photoUrl: 'https://nowadays.nyc/wp-content/uploads/2026/01/x3-1500x1500.jpg',
    location: 'New York',
    socialLinks: {
      customLinks: [
        { label: 'Crack', url: 'https://soundcloud.com/crackmagazine/crack-mix-611-x3butterfly' },
        { label: 'Live at Dekmantel Selectors', url: 'https://soundcloud.com/dkmntl/x3butterfly-at-dekmantel' },
      ],
    },
  },
];

async function createNowadaysDJs() {
  console.log(`Creating ${nowadaysDJs.length} pending DJ profiles...\n`);

  let created = 0;
  let skipped = 0;

  for (const dj of nowadaysDJs) {
    const normalizedUsername = dj.username.replace(/\s+/g, '').toLowerCase();

    // Check if username is already taken
    const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
    if (usernameDoc.exists) {
      console.log(`SKIP: "${dj.username}" — username already taken`);
      skipped++;
      continue;
    }

    // Check if a pending profile with this normalized username already exists
    const existingPending = await db.collection('pending-dj-profiles')
      .where('chatUsernameNormalized', '==', normalizedUsername)
      .limit(1)
      .get();

    if (!existingPending.empty) {
      console.log(`SKIP: "${dj.username}" — pending profile already exists`);
      skipped++;
      continue;
    }

    const pendingProfileRef = db.collection('pending-dj-profiles').doc();
    const usernameRef = db.collection('usernames').doc(normalizedUsername);

    await db.runTransaction(async (transaction) => {
      transaction.set(pendingProfileRef, {
        chatUsername: dj.username,
        chatUsernameNormalized: normalizedUsername,
        djProfile: {
          bio: dj.bio,
          photoUrl: dj.photoUrl,
          location: dj.location,
          genres: [],
          promoText: null,
          promoHyperlink: null,
          socialLinks: dj.socialLinks,
          irlShows: [],
          radioShows: [],
          myRecs: {},
        },
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: 'script',
      });

      transaction.set(usernameRef, {
        displayName: dj.username,
        usernameHandle: normalizedUsername,
        uid: `pending:${pendingProfileRef.id}`,
        isPending: true,
        claimedAt: FieldValue.serverTimestamp(),
      });
    });

    console.log(`CREATED: "${dj.username}" → /dj/${normalizedUsername}`);
    created++;
  }

  console.log(`\nDone! Created: ${created}, Skipped: ${skipped}`);
}

createNowadaysDJs()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
