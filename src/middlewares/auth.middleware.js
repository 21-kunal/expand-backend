import { User } from '../models/user.model.js';
import { apiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import jwt from 'jsonwebtoken';

const verifyJWT = asyncHandler(async (req, res, next) => {
    try {
        const accessToken =
            req.cookies?.accessToken ||
            req.header('Authorization').replace('Bearer', '');

        if (!accessToken) {
            throw new apiError(401, 'Unauthorized request');
        }

        const decodedInformation = jwt.verify(
            accessToken,
            process.env.ACCESS_TOKEN_SECRET
        );

        const user = User.findById(decodedInformation?._id).select(
            '-password -refreshToken'
        );

        if (!user) {
            throw new apiError(401, 'Invalid Access Token');
        }

        req.user = user;
        next();
    } catch (error) {
        throw new apiError(401, error?.message || 'Invalid Access Token');
    }
});

export { verifyJWT };
