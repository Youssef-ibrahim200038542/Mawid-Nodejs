// The session cookie's name, shared by the session middleware and every place that clears it.
// Production uses a __Host- cookie (Secure, Path=/, no Domain): browsers refuse it otherwise, so no
// sibling subdomain can set or overwrite the session cookie. Development keeps the old name.
const production = process.env.NODE_ENV === "production";
const cookieName = production ? "__Host-mawid.sid" : "connect.sid";

module.exports = { cookieName, production };
