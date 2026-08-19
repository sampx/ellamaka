/**
 * Web application entry: thin bootstrap over the shell library.
 */
import { AppWebEntry } from "@deepseek-ai/dsh-client-web"

const el = document.getElementById("root")
if (el === null) throw new Error("web app: missing #root")
void new AppWebEntry(el).run()
