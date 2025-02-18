const User = require('../models/User');
const Link = require('../models/Link');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');


// Register User
exports.registerUser = async (req, res) => {
  const { name, email, password, address, dob, phone, profileImage } = req.body;
  try {
    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

 

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({
      name,
      email,
      password: hashedPassword,
      address,
      dob,
      phone,
      profileImage,
    });

    await user.save();

    const payload = {
      user: {
        id: user.id,
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
      (err, token) => {
        if (err) throw err;
        res.status(201).json({ token });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};


// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage }).single('file');

exports.uploadUserImage =  (req, res) => {
  upload(req, res, function (err) {
    if (err) {
      return res.status(400).json({ success: false, message: 'Failed to upload image', error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const imageUrl = `${req.protocol}://${req.get('host')}/public/uploads/${req.file.filename}`;
    res.json({ success: true, url: imageUrl });
  });
};



// Login User

exports.loginUser = async (req, res) => {
  const { email, password, latitude, longitude } = req.body;

  try {
    // Find the user by email
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Compare the provided password with the stored password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Update user's location
    user.latitude = latitude;
    user.longitude = longitude;

    // Save the updated user document
    await user.save();

    // Create a payload for the JWT token
    const payload = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        address: user.address,
        dob: user.dob,
        phone: user.phone,
        profileImage: user.profileImage,
        latitude: user.latitude,
        longitude: user.longitude,
      },
    };

    // Sign and return the JWT token
    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '1h' },
      (err, token) => {
        if (err) throw err;
        res.status(200).json({ token, user: payload.user });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
};




exports.searchUser = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).send('Query parameter is required');
    }
    const regex = new RegExp(q, 'i'); // Case-insensitive search
    const users = await User.find({ name: regex }).limit(10); // Adjust limit as needed
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
}

exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).send('User ID parameter is required');
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user by ID:', error.message);
    res.status(500).json({ message: error.message });
  }
};

exports.linkUser = async (req, res) => {
  const { user_id, userId } = req.body;

  try {

    // Validate if user_id and userId exist
    const user1 = await User.findById(user_id);
    const user2 = await User.findById(userId);
    if (!user1 || !user2) {
      return res.status(404).json({ message: 'One or both users not found' });
    }


    // Check if link already exists (prevent duplicates)
    const existingLink = await Link.findOne({ user_id, userId });
    if (existingLink) {
      return res.status(400).json({ message: 'Users are already linked' });
    }

    // Create a new link
    const link = new Link({
      user_id,
      userId,
    });

   // Save the link to the database
   const savedLink = await link.save();

   // Send the link ID to the frontend
   res.status(200).json({ message: 'Link created successfully', linkId: savedLink._id });
  } catch (err) {
    console.error('Error linking users:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};


// Get linked users for a specific user
exports.getLinkedUsers = async (req, res) => {
  const { userId } = req.query;
  const userObjectId = new mongoose.Types.ObjectId(userId);

  try {
    // Find links where the user is either user_id or userId
    const links = await Link.find({
      $or: [{ user_id: userObjectId }, { userId: userObjectId }]
    })
      .populate('user_id', 'name profileImage')
      .populate('userId', 'name profileImage');

    // Extract the linked users, excluding the logged-in user
    const linkedUsers = links.map(link => {
      if (link.user_id._id.equals(userObjectId)) {
        return link.userId;
      }
      return link.user_id;
    }).filter(user => !user._id.equals(userObjectId)); // Exclude the logged-in user

    res.status(200).json(linkedUsers);
  } catch (err) {
    console.error('Error fetching linked users:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};


// Function to unlink users
exports.unlinkUser = async (req, res) => {
  const { linkId } = req.body;

  const linkObjectId = new mongoose.Types.ObjectId(linkId);

  try {
    // Remove the link using the linkId
    const result = await Link.deleteOne({ _id: linkObjectId });

    // Check if a document was deleted
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Link not found' });
    }

    res.status(200).json({ message: 'User unlinked successfully' });
  } catch (err) {
    console.error('Error unlinking user:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};
