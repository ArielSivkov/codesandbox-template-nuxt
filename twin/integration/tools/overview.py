import cv2, numpy as np, sys
d = sys.argv[1]; a = [cv2.imread(f'{d}/{f}') for f in ['006.jpg', '008.jpg', '032.jpg']]; b = cv2.imread(f'{d}/015.jpg')
top = np.concatenate(a, axis=1); b2 = cv2.resize(b, (top.shape[1], int(b.shape[0] * top.shape[1] / b.shape[1]))); cv2.imwrite(f'{d}/_all.jpg', np.concatenate([top, b2], axis=0), [cv2.IMWRITE_JPEG_QUALITY, 80])
