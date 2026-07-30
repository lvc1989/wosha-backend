import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set in your .env file. Refusing to start with an insecure default.");
  process.exit(1);
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, locationId: user.location_id, name: user.name },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided." });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session — please log in again." });
  }
}

// Usage: requireRole("owner", "manager")
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}
