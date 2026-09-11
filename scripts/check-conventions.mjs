import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const subjectPattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: \S.+$/;
const branchPattern = /^(feat|fix|chore|docs|refactor|test)\/[a-z0-9]+(?:[a-z0-9/-]*[a-z0-9])?$/;
const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  : {};
const pr = event.pull_request;
const branch = pr?.head.ref ?? process.env.GITHUB_REF_NAME ?? git('branch', '--show-current');
const failures = [];
if (branch !== 'main' && !branchPattern.test(branch)) failures.push(`Invalid branch: ${branch}`);
if (pr && !subjectPattern.test(pr.title)) failures.push('PR title must use Conventional Commits.');
const range = pr ? `${pr.base.sha}..${pr.head.sha}` : 'HEAD';
const commits = git('rev-list', range).split('\n').filter(Boolean);
for (const commit of commits) {
  const [author, email, subject] = git('show', '-s', '--format=%an%n%ae%n%s', commit).split('\n');
  if (author !== 'heznpc' || email !== '222764483+heznpc@users.noreply.github.com') {
    failures.push(`${commit.slice(0, 7)}: use the Heznpc noreply author identity.`);
  }
  if (!subjectPattern.test(subject)) failures.push(`${commit.slice(0, 7)}: invalid commit subject.`);
  if (/^Co-authored-by:/im.test(git('show', '-s', '--format=%B', commit))) {
    failures.push(`${commit.slice(0, 7)}: co-author trailers are not used in this repository.`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Conventions passed: ${branch}, ${commits.length} commit(s).`);
}
