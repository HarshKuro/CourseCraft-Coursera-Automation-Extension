import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const projectRoot = path.resolve('.');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const version = manifest.version || '1.0.0';
const zipName = `CourseCraft-v${version}.zip`;
const outputPath = path.join(projectRoot, zipName);

if (fs.existsSync(outputPath)) {
  fs.unlinkSync(outputPath);
}

console.log(`Packaging CourseCraft v${version} into ${zipName}...`);

try {
  if (process.platform === 'win32') {
    const cmd = `powershell -NoProfile -Command "Compress-Archive -Path manifest.json, dist, LICENSE, README.md, HOW_IT_WORKS.md -DestinationPath '${zipName}' -Force"`;
    execSync(cmd, { stdio: 'inherit', cwd: projectRoot });
  } else {
    const cmd = `zip -r "${zipName}" manifest.json dist LICENSE README.md HOW_IT_WORKS.md -x "*.DS_Store" "*__MACOSX*"`;
    execSync(cmd, { stdio: 'inherit', cwd: projectRoot });
  }

  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    console.log(`✅ Successfully built ${zipName} (${(stats.size / 1024).toFixed(1)} KB)`);
  } else {
    throw new Error('ZIP file was not created');
  }
} catch (err) {
  console.error('❌ Build failed:', err.message);
  process.exit(1);
}
