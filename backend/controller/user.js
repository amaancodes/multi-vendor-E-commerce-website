const express = require("express");
const path = require("path");
const User = require("../model/user");
const router = express.Router();
const { upload } = require("../multer");
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const sendToken = require("../utils/jwtToken");
const { isAuthenticated, isAdmin } = require("../middleware/auth");
const ReferralCode = require("../model/referralCode");
const { generateReferralCode, verifyReferralCode, updateReferralUsage } = require("../utils/ReferralCodeGenerate");
const referralController = require("./referralController");

router.post("/create-user", upload.single("file"), async (req, res, next) => {
  try {
    const { name, email, password, phoneNumber, panCard, gender, inputReferralCode } = req.body;

    // Check for required fields
    if (!name || !password || !phoneNumber || !panCard || !gender) {
      if (req.file) {
        const filename = req.file.filename;
        const filePath = `uploads/${filename}`;
        fs.unlink(filePath, (err) => {
          if (err) {
            console.log(err);
          }
        });
      }
      return next(new ErrorHandler("Please provide all required fields!", 400));
    }

    // Verify referral code if provided
    let referrerDetails = null;
    if (inputReferralCode) {
      referrerDetails = await verifyReferralCode(inputReferralCode);
      if (!referrerDetails) {
        return next(new ErrorHandler("Invalid referral code!", 400));
      }
    }

    // Generate new referral code for the registering user
    const newUserReferralCode = await generateReferralCode(name);

    // Check if user exists with same email (if provided)
    if (email) {
      const userEmail = await User.findOne({ email });
      if (userEmail) {
        if (req.file) {
          const filename = req.file.filename;
          const filePath = `uploads/${filename}`;
          fs.unlink(filePath, (err) => {
            if (err) {
              console.log(err);
            }
          });
        }
        return next(new ErrorHandler("Email already exists", 400));
      }
    }

    // Check if PAN card already exists
    const existingPanCard = await User.findOne({ panCard: panCard.toUpperCase() });
    if (existingPanCard) {
      if (req.file) {
        const filename = req.file.filename;
        const filePath = `uploads/${filename}`;
        fs.unlink(filePath, (err) => {
          if (err) {
            console.log(err);
          }
        });
      }
      return next(new ErrorHandler("PAN card already registered", 400));
    }

    // Set default avatar if no file is uploaded
    let fileUrl = "defaultAvatar.png";
    if (req.file) {
      fileUrl = path.join(req.file.filename);
    }

    // Create user with referral information
    const user = await User.create({
      name,
      email,
      password,
      phoneNumber,
      panCard,
      gender,
      avatar: fileUrl,
      referralCode: newUserReferralCode,
      referredBy: referrerDetails ? referrerDetails.referrerId : null
    });

    // Create referral code document
    await ReferralCode.create({
      code: newUserReferralCode,
      userId: user._id,
      userName: user.name
    });

    // Update referral usage if referral code was used
    if (referrerDetails) {
      await updateReferralUsage(inputReferralCode, user._id, user.name);
    }

    // Add referrer details to response
    const responseData = {
      success: true,
      user,
      referrer: referrerDetails ? {
        name: referrerDetails.referrerName,
        referralCode: referrerDetails.referralCode
      } : null
    };

    sendToken(user, 201, res, responseData);

  } catch (error) {
    // If any error occurs and file was uploaded, delete it
    if (req.file) {
      const filename = req.file.filename;
      const filePath = `uploads/${filename}`;
      fs.unlink(filePath, (err) => {
        if (err) {
          console.log(err);
        }
      });
    }
    return next(new ErrorHandler(error.message, 400));
  }
});

// login user
router.post(
  "/login-user",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return next(new ErrorHandler("Please provide the all fields!", 400));
      }

      const user = await User.findOne({ email }).select("+password");

      if (!user) {
        return next(new ErrorHandler("User doesn't exists!", 400));
      }

      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        return next(
          new ErrorHandler("Please provide the correct information", 400)
        );
      }

      sendToken(user, 201, res);
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// load user
router.get(
  "/getuser",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return next(new ErrorHandler("User doesn't exists", 400));
      }

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// log out user
router.get(
  "/logout",
  catchAsyncErrors(async (req, res, next) => {
    try {
      res.cookie("token", null, {
        expires: new Date(Date.now()),
        httpOnly: true,
      });
      res.status(201).json({
        success: true,
        message: "Log out successful!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update user info
router.put(
  "/update-user-info",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { email, password, phoneNumber, name } = req.body;

      const user = await User.findOne({ email }).select("+password");

      if (!user) {
        return next(new ErrorHandler("User not found", 400));
      }

      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        return next(
          new ErrorHandler("Please provide the correct information", 400)
        );
      }

      user.name = name;
      user.email = email;
      user.phoneNumber = phoneNumber;

      await user.save();

      res.status(201).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update user avatar
router.put(
  "/update-avatar",
  isAuthenticated,
  upload.single("image"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const existsUser = await User.findById(req.user.id);

      const existAvatarPath = `uploads/${existsUser.avatar}`;

      fs.unlinkSync(existAvatarPath);

      const fileUrl = path.join(req.file.filename);

      const user = await User.findByIdAndUpdate(req.user.id, {
        avatar: fileUrl,
      });

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update user addresses
router.put(
  "/update-user-addresses",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);

      const sameTypeAddress = user.addresses.find(
        (address) => address.addressType === req.body.addressType
      );
      if (sameTypeAddress) {
        return next(
          new ErrorHandler(`${req.body.addressType} address already exists`)
        );
      }

      const existsAddress = user.addresses.find(
        (address) => address._id === req.body._id
      );

      if (existsAddress) {
        Object.assign(existsAddress, req.body);
      } else {
        // add the new address to the array
        user.addresses.push(req.body);
      }

      await user.save();

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// delete user address
router.delete(
  "/delete-user-address/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const userId = req.user._id;
      const addressId = req.params.id;

      console.log(addressId);

      await User.updateOne(
        {
          _id: userId,
        },
        { $pull: { addresses: { _id: addressId } } }
      );

      const user = await User.findById(userId);

      res.status(200).json({ success: true, user });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update user password
router.put(
  "/update-user-password",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id).select("+password");

      const isPasswordMatched = await user.comparePassword(
        req.body.oldPassword
      );

      if (!isPasswordMatched) {
        return next(new ErrorHandler("Old password is incorrect!", 400));
      }

      if (req.body.newPassword !== req.body.confirmPassword) {
        return next(
          new ErrorHandler("Password doesn't matched with each other!", 400)
        );
      }
      user.password = req.body.newPassword;

      await user.save();

      res.status(200).json({
        success: true,
        message: "Password updated successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// find user infoormation with the userId
router.get(
  "/user-info/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);

      res.status(201).json({
        success: true,
        user,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// all users --- for admin
router.get(
  "/admin-all-users",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const users = await User.find().sort({
        createdAt: -1,
      });
      res.status(201).json({
        success: true,
        users,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// delete users --- admin
router.delete(
  "/delete-user/:id",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);

      if (!user) {
        return next(
          new ErrorHandler("User is not available with this id", 400)
        );
      }

      await User.findByIdAndDelete(req.params.id);

      res.status(201).json({
        success: true,
        message: "User deleted successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// Add a new route to apply referral code
router.post("/apply-referral", catchAsyncErrors(async (req, res, next) => {
  try {
    const { referralCode, userId } = req.body;

    const referral = await ReferralCode.findOne({ code: referralCode });
    if (!referral) {
      return next(new ErrorHandler("Invalid referral code", 400));
    }

    // Check if user is trying to use their own referral code
    if (referral.userId.toString() === userId) {
      return next(new ErrorHandler("Cannot use your own referral code", 400));
    }

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return next(new ErrorHandler("User not found", 400));
    }

    if (user.referredBy) {
      return next(new ErrorHandler("You have already used a referral code", 400));
    }

    // Update user with referral information
    user.referredBy = referral.userId;
    await user.save();

    // Use the referralController to update usage
    await updateReferralUsage(referralCode, userId);

    res.status(200).json({
      success: true,
      message: "Referral code applied successfully"
    });

  } catch (error) {
    return next(new ErrorHandler(error.message, 500));
  }
}));

module.exports = router;
