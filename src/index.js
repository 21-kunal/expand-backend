import { app } from "./app.js";
import connectDB from "./db/index.js";
import dotenv from "dotenv";

dotenv.config({ path: "./env" });

connectDB()
  .then(() => {
    app.on("error", (err) => {
      console.log(`Error in app: ${err}`);
      throw err;
    });

    app.listen(process.env.PORT || 8000, () => {
      console.log(`app is running on port: ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("MongoDB connection error: ", err);
  });
