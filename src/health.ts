import {startHealthServer} from "./release/health-server.js";

const port=Number(process.env.PORT??3000);
startHealthServer({port});
console.log(JSON.stringify({system:"LayanX AI",status:"healthy",port}));
