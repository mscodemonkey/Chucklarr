import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

type PackageFile = {
  version?: string;
};

type PackageLockFile = {
  version?: string;
  packages?: {
    ''?: {
      version?: string;
    };
  };
};

test('release metadata is updated consistently', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as PackageFile;
  const packageLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')) as PackageLockFile;
  const version = packageJson.version;
  const readmeVersion = readme.match(/^Latest release version: `v([^`]+)`/m)?.[1];
  const readmeDate = readme.match(/^Latest release date: `(\d{4}-\d{2}-\d{2})`/m)?.[1];

  assert.ok(version, 'package.json version is required.');
  assert.equal(packageLock.version, version, 'package-lock.json root version must match package.json.');
  assert.equal(packageLock.packages?.['']?.version, version, 'package-lock.json package version must match package.json.');
  assert.equal(readmeVersion, version, 'README latest release version must match package.json.');
  assert.ok(readmeDate, 'README latest release date is required.');
  assert.match(readme, new RegExp(`^### ${readmeDate}$`, 'm'), 'README changelog must include the latest release date.');
});
