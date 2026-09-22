import { Router } from "express";
import multer from "multer";
import { store } from "../data/store.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
export const brandingRouter = Router();

brandingRouter.get("/", (req, res) => {
  res.json({ bannerImage: store.getBannerImage() });
});

brandingRouter.post("/banner", upload.single("banner"), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "banner image is required" });
  }
  if (!file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "banner must be an image file" });
  }
  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  store.setBannerImage(dataUri);
  res.json({ bannerImage: dataUri });
});

brandingRouter.delete("/banner", (req, res) => {
  store.setBannerImage(null);
  res.status(204).send();
});
