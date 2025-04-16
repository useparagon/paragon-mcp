async function main() {
  const tokenInfo = JSON.parse(
    document.getElementById("token-info").textContent
  );

  await paragon.authenticate(tokenInfo.projectId, tokenInfo.loginToken);

  paragon.connect(tokenInfo.integrationName, {
    onError: (error) => {
      console.error("Error connecting to integration", error);
    },
    onSuccess: () => {
      console.log("Connected to integration");
    },
  });
}

main();
