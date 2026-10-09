/**
 * Reset the dev stack to the fixture inbox:  pnpm seed-dev
 * Refuses to touch anything that is not TheLibrary-dev.
 */
import { devStack, seedDev, wipeDevTable } from "./dev-stack.js";

const stack = await devStack();
console.log(`Wiping ${stack.tableName}...`);
console.log(`  deleted ${await wipeDevTable(stack)} items`);
const counts = await seedDev(stack);
console.log(`Seeded ${counts.newsletters} newsletters and ${counts.filtered} filtered markers.`);
