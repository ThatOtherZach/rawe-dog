import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import appHealthRouter from "./app-health.js";
import appSettingsRouter from "./app-settings.js";
import appGenerateRouter from "./app-generate.js";
import appLibraryRouter from "./app-library.js";
import appExportRouter from "./app-export.js";
import appPostingsRouter from "./app-postings.js";
import appCreditsRouter from "./app-credits.js";
import appWipeRouter from "./app-wipe.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(appHealthRouter);
router.use(appSettingsRouter);
router.use(appGenerateRouter);
router.use(appLibraryRouter);
router.use(appExportRouter);
router.use(appPostingsRouter);
router.use(appCreditsRouter);
router.use(appWipeRouter);

export default router;
