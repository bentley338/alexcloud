const express = require('express');

const router = express.Router();

router.get('/support', (req, res) => {
  res.render('support', {
    title: 'Pusat Bantuan - AlexCloud',
    user: req.user || null
  });
});

router.get('/cookies', (req, res) => {
  res.render('cookies', {
    title: 'Kebijakan Cookie - AlexCloud',
    user: req.user || null,
    lastUpdated: '22 September 2026'
  });
});

module.exports = router;
