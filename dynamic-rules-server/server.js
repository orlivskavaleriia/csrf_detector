const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3000;

// Віддаємо статичні файли (в тому числі csrf-rules.json)
app.use(express.static(path.join(__dirname)));

// Додатковий маршрут (не обов'язково, але можна)
app.get('/csrf-rules.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'csrf-rules.json'));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
