// const { Innertube } = require("youtubei.js");

// (async () => {
//   const youtube = await Innertube.create();

//   const info = await youtube.getInfo("aqz-KE-bpKQ");

//   console.log("Title:", info.basic_info.title);
// })();

// const dns = require("dns");
// dns.setDefaultResultOrder("ipv4first");

// const ytdl = require("@distube/ytdl-core");

// (async () => {
//   try {
//     const info = await ytdl.getInfo(
//       "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
//     );
//     console.log("Formats:", info.formats.length);
//   } catch (err) {
//     console.error("ERROR:", err.message);
//   }
// })();

const { Innertube } = require("youtubei.js");
const { VM } = require("vm2");
const fs = require("fs");

(async () => {
  const yt = await Innertube.create({
    player: {
      js: {
        eval: (code) => {
          const vm = new VM();
          return vm.run(code);
        },
      },
    },
  });

  const info = await yt.getInfo("aqz-KE-bpKQ");
  console.log(info.basic_info.title);

  const stream = await yt.download("aqz-KE-bpKQ", {
    quality: "best",
    type: "video+audio",
  });

  stream.pipe(fs.createWriteStream("video.mp4"));
})();