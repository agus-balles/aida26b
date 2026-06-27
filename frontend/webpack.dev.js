import { merge } from "webpack-merge";
import common from "./webpack.common.js";

export default merge(common, {
  mode: "development",
  devtool: "eval-source-map",
  devServer: {
    host: "0.0.0.0",
    port: 8080,
    hot: true,
    client: {
      overlay: {
        errors: true,
        warnings: false,
        runtimeErrors: false,
      },
    },
    historyApiFallback: true,
    proxy: [
      {
        context: ["/api"],
        target: process.env.API_URL ?? "http://localhost:3000",
      },
    ],
  },
});
