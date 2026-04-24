-- CampusRank Database Setup
-- Run this setup in your MySQL client to prepare the database structure

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  erp VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('student', 'admin', 'superadmin') DEFAULT 'student',
  total_points INT DEFAULT 0,
  club_id INT DEFAULT NULL,
  course VARCHAR(100) DEFAULT NULL,
  branch VARCHAR(255) DEFAULT 'Unspecified',
  semester VARCHAR(100) DEFAULT 'Not Set',
  college VARCHAR(255) DEFAULT 'Not Specified',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Certificates Table
CREATE TABLE IF NOT EXISTS certificates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  club_id INT NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  position ENUM('winner', 'runnerup1', 'runnerup2', 'participant') NOT NULL,
  event_date DATE NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  points INT DEFAULT 0,
  verified_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Event Participation (Central Source of Truth for Points)
CREATE TABLE IF NOT EXISTS event_participation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  club_id INT,
  event_name VARCHAR(255),
  event_date DATE,
  position ENUM('winner','runnerup1','runnerup2','participant'),
  source ENUM('manual','e_certificate'),
  points INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_event (user_id, club_id, event_name, event_date),
  CONSTRAINT fk_ep_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ep_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- ─── Event Registration System ────────────────────────────────────────────────

-- Forms Table: Stores each registration form created by a club admin
CREATE TABLE IF NOT EXISTS forms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  club_id INT,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  event_date DATE,
  venue VARCHAR(255),
  type ENUM('solo','team') DEFAULT 'solo',
  team_size INT DEFAULT 1,
  start_date DATETIME,
  end_date DATETIME,
  status ENUM('active','closed') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Form Fields Table: Custom fields defined by the admin per form
CREATE TABLE IF NOT EXISTS form_fields (
  id INT AUTO_INCREMENT PRIMARY KEY,
  form_id INT NOT NULL,
  field_name VARCHAR(255) NOT NULL,
  field_type ENUM('text','number','email','select','file') DEFAULT 'text',
  options TEXT,                                -- Comma-separated values for 'select' type
  required BOOLEAN DEFAULT FALSE,
  apply_to ENUM('leader','all') DEFAULT 'all', -- 'leader' = only team captain fills this
  field_order INT DEFAULT 0,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

-- Template Tables
CREATE TABLE IF NOT EXISTS form_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  description TEXT,
  type ENUM('solo','team'),
  team_size INT,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template_fields (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT,
  field_name VARCHAR(255),
  field_type ENUM('text','number','email','select','file'),
  required BOOLEAN,
  apply_to ENUM('leader','all'),
  field_order INT,
  FOREIGN KEY (template_id) REFERENCES form_templates(id) ON DELETE CASCADE
);

-- Submissions Table: One row per student (or team) registration
CREATE TABLE IF NOT EXISTS submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  form_id INT NOT NULL,
  user_id INT NOT NULL,                        -- The student (team leader for team events)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

-- Submissions Data Table: Stores the actual field values per submission
CREATE TABLE IF NOT EXISTS submission_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  submission_id INT NOT NULL,
  field_id INT NOT NULL,
  value TEXT,
  member_index INT DEFAULT 1,                  -- 1 = leader, 2+ = other team members
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES form_fields(id) ON DELETE CASCADE
);

-- Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action_type VARCHAR(100),
  target_id INT,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  title VARCHAR(255),
  message TEXT,
  type ENUM('info','success','warning'),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Leaderboard Cache
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  user_id INT,
  club_id INT,
  total_points INT,
  month INT,
  year INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, club_id, month, year),
  CONSTRAINT fk_lc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_lc_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

