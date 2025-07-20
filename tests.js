import { ExtentSet, ExtentSetsWithNames, planMoves } from './extents.js';

function testMerge() {
  const set = new ExtentSet();
  set.extents = [
    { start: 100, size: 10 },
    { start: 115, size: 5 },
    { start: 110, size: 10 },  // overlaps with both
    { start: 130, size: 10 }
  ];

  console.log("Before merge:");
  set.dump();

  set.merge();

  console.log("\nAfter merge:");
  set.dump();

  set.add(120, 5);
  console.log("\nAfter adding [120, 125):");
  set.dump();

  set.remove(105, 10);
  console.log("\nAfter removing [105, 115):");
  set.dump(); 

  const allocated = set.allocate(4);
  console.log("\nAfter allocating 4:");
  console.log(`Allocated: [${allocated.start}, ${allocated.start + allocated.size})`);
  set.dump();
}

function runPlan(extentsToMove, freeExtents) {
  const usedSets = new ExtentSetsWithNames();
  const freeSets = new ExtentSetsWithNames();

  // Set initial used and free extents
  usedSets.addExtents(extentsToMove);
  freeSets.addExtents(freeExtents);

  usedSets.dump("Initial Used");
  freeSets.dump("Initial Free");

  console.log("\nPlan Moves:");
  let { moves, failedMoves } = planMoves(extentsToMove, freeSets, usedSets);

  console.log("\nMove Plan:");
  for (const cmd of moves) {
    console.log(`  Moved ${cmd.type} '${cmd.name}' -> ${cmd.from_set}[${cmd.from_start}, ${cmd.from_start+cmd.size}) -> ${cmd.to_set}[${cmd.to_start}, ${cmd.to_start+cmd.size})`);
  }

  freeSets.dump("Final Free");
  usedSets.dump("Final Used");
}

function testPlan() {
  const move = [
    {
      "to_start": 192512,
      "to_set": "/dev/mapper/ssd_crypt",
      "size": 25600,
      "from_start": 64512,
      "from_set": "/dev/mapper/ssd_crypt",
      "name": "servers #2 (51200-76800)"
    },
    {
      "to_start": 64512,
      "to_set": "/dev/mapper/ssd_crypt",
      "size": 128000,
      "from_start": 90112,
      "from_set": "/dev/mapper/ssd_crypt",
      "name": "media #1 (0-128000)"
    },
    {
      "to_start": 1988609,
      "to_set": "/dev/mapper/tank_r1_crypt",
      "size": 632794,
      "from_start": 0,
      "from_set": "/dev/mapper/tank_r1_crypt",
      "name": "archive #1 (0-632794)"
    },
    {
      "to_start": 314575,
      "to_set": "/dev/mapper/tank_r1_crypt",
      "size": 179201,
      "from_start": 632794,
      "from_set": "/dev/mapper/tank_r1_crypt",
      "name": "archive #2 (632794-811995)"
    },
    {
      "to_start": 1087490,
      "to_set": "/dev/mapper/tank_r1_crypt",
      "size": 102437,
      "from_start": 811995,
      "from_set": "/dev/mapper/tank_r1_crypt",
      "name": "archive #3 (811995-914432)"
    },
    {
      "to_start": 1248501,
      "to_set": "/dev/mapper/tank_r1_crypt",
      "size": 210944,
      "from_start": 914432,
      "from_set": "/dev/mapper/tank_r1_crypt",
      "name": "archive #4 (914432-1125376)"
    },
    {
      "to_start": 1587445,
      "to_set": "/dev/mapper/tank_r1_crypt",
      "size": 401164,
      "from_start": 1125376,
      "from_set": "/dev/mapper/tank_r1_crypt",
      "name": "archive #5 (1125376-1526540)"
    },
    {
      "to_start": 0,
      "to_set": "/dev/mapper/tank_r1_crypt",
      "size": 314575,
      "from_start": 1526540,
      "from_set": "/dev/mapper/tank_r1_crypt",
      "name": "archive #6 (1526540-1841115)"
    },
    {
      "to_start": 2621403,
      "to_set": "/dev/mapper/tank_r1_crypt",
      "size": 227365,
      "from_start": 1841115,
      "from_set": "/dev/mapper/tank_r1_crypt",
      "name": "archive #7 (1841115-2068480)"
    }
  ];

  const free = [
    {
      "from_start": 474112,
      "size": 2495,
      "from_set": "/dev/mapper/ssd_crypt"
    },
    {
      "from_start": 2068480,
      "size": 792822,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 780288,
      "size": 173537,
      "from_set": "/dev/mapper/tank_r2_crypt"
    }
  ];

  // testMerge();
  runPlan(move, free);
}

function testPlan2() {
  const move = [
    {
      "to_start": 192512,
      "to_set": "/dev/mapper/ssd_crypt",
      "size": 25600,
      "from_start": 64512,
      "from_set": "/dev/mapper/ssd_crypt",
      "name": "servers #2 (51200-76800)"
    },
    {
      "to_start": 64512,
      "to_set": "/dev/mapper/ssd_crypt",
      "size": 128000,
      "from_start": 90112,
      "from_set": "/dev/mapper/ssd_crypt",
      "name": "media #1 (0-128000)"
    }
  ];

  const free = [
    {
      "from_start": 474112,
      "size": 2495,
      "from_set": "/dev/mapper/ssd_crypt"
    },
    {
      "from_start": 493776,
      "size": 593714,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 1189927,
      "size": 58574,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 1459445,
      "size": 128000,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 2848768,
      "size": 12534,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 780288,
      "size": 173537,
      "from_set": "/dev/mapper/tank_r2_crypt"
    }
  ];

  runPlan(move, free);
}

function testPlan3() {
  const move = [
    {
      "to_start": 64512,
      "to_set": "/dev/mapper/ssd_crypt",
      "size": 128000,
      "from_start": 13312,
      "from_set": "/dev/mapper/ssd_crypt",
      "name": "media #1 (0-128000)"
    },
    {
      "to_start": 218112,
      "to_set": "/dev/mapper/ssd_crypt",
      "size": 256000,
      "from_start": 141312,
      "from_set": "/dev/mapper/ssd_crypt",
      "name": "media #2 (128000-384000)"
    },
    {
      "to_start": 13312,
      "to_set": "/dev/mapper/ssd_crypt",
      "size": 51200,
      "from_start": 397312,
      "from_set": "/dev/mapper/ssd_crypt",
      "name": "servers #1 (0-51200)"
    },
    {
      "to_start": 192512,
      "to_set": "/dev/mapper/ssd_crypt",
      "size": 25600,
      "from_start": 448512,
      "from_set": "/dev/mapper/ssd_crypt",
      "name": "servers #2 (51200-76800)"
    }
  ];

  const free = [
    {
      "from_start": 474112,
      "size": 2495,
      "from_set": "/dev/mapper/ssd_crypt"
    },
    {
      "from_start": 493776,
      "size": 593714,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 1189927,
      "size": 58574,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 1459445,
      "size": 128000,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 2848768,
      "size": 12534,
      "from_set": "/dev/mapper/tank_r1_crypt"
    },
    {
      "from_start": 780288,
      "size": 173537,
      "from_set": "/dev/mapper/tank_r2_crypt"
    }
  ];
  runPlan(move, free);
}

testPlan3();
