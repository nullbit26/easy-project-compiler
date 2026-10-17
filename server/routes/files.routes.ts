import { Router, Request, Response } from 'express';
import {
  addCheckpoint,
  applyChanges,
  bindFolder,
  browseFolder,
  fixChecks,
  generateChanges,
  getBackups,
  getChecks,
  getCheckpoints,
  getWeightBudget,
  getWorkspace,
  pickFolderDialog,
  readFile,
  removeCheckpoint,
  rollback,
  runChecks,
  scanFolder,
  setWeightBudget,
  unbindFolder,
  undoChanges,
  writeFile
} from '../controllers/files.controller';
import {
  commitGitHandler,
  createGitBranchHandler,
  getGitBranchDiffHandler,
  getGitBranchesHandler,
  getGitDiffHandler,
  getGitStatusHandler
} from '../controllers/git.controller';
import { requireLocal } from '../utils/localRequest';

const router = Router();

router.use((req, res, next) => {
  const allowed = requireLocal(
    req,
    res,
    'Project files can only be read or changed from the machine that runs the app (localhost).'
  );
  if (!allowed) return;
  next();
});

router.get('/workspace', getWorkspace);
router.post('/bind', bindFolder);
router.post('/unbind', unbindFolder);
router.get('/browse', browseFolder);
// Windows/macOS: shows the real system dialog and answers with the chosen folder.
router.post('/pick-folder', pickFolderDialog);
router.post('/scan', scanFolder);
router.get('/file', readFile);
router.put('/file', writeFile);
router.post('/apply', applyChanges);
router.post('/undo', undoChanges);
router.get('/backups', getBackups);
router.post('/generate-changes', generateChanges);

// Verification: what can be checked, run it, and repair what it reports.
router.get('/checks', getChecks);
router.post('/verify', runChecks);
router.post('/fix-checks', fixChecks);

// The weight budget: the ceiling this project may not grow past, judged against a real build.
router.get('/weight/budget', getWeightBudget);
router.post('/weight/budget', setWeightBudget);

// Git: what changed in the folder, one file's diff, and a local commit of the selected files.
// Remote commands (push/pull/fetch) are deliberately absent from the service.
router.get('/git/status', getGitStatusHandler);
router.get('/git/diff', getGitDiffHandler);
router.post('/git/commit', commitGitHandler);

// Branches: which one the folder is on, starting one for a piece of work, and what one branch
// has that another does not. Still local — there is no remote here to switch anything to.
router.get('/git/branches', getGitBranchesHandler);
router.post('/git/branches', createGitBranchHandler);
router.get('/git/branch-diff', getGitBranchDiffHandler);

// Checkpoints: named moments in the timeline, and going back to one.
router.get('/checkpoints', getCheckpoints);
router.post('/checkpoints', addCheckpoint);
router.delete('/checkpoints/:id', removeCheckpoint);
router.post('/rollback', rollback);

export default router;
